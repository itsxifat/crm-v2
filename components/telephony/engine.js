/**
 * components/telephony/engine.js — the browser phone (browser-only, no React).
 *
 * One person usually has several CRM tabs open. Envo rings every web phone registered
 * on an extension, so if each tab registered, every tab would ring. Instead the tabs
 * elect one (a Web Lock): that tab registers with Envo (JsSIP over WebSocket), holds
 * the call and plays its audio; the others mirror its state over a BroadcastChannel and
 * send it what the person presses. Closing that tab hands the phone to the next one.
 *
 * The ringtone plays in whichever tab the person can see (the phone's tab if it is
 * visible, else any visible tab, else the phone's tab with a desktop notification).
 *
 * The JsSIP handling follows Envo's own web phone (envo/web/src/phone/PhoneProvider.tsx).
 */
import { Tones } from './tones'
import { dialable } from '@/lib/telephony/numbers'

const HISTORY_MAX = 50
const RETRY_MS = [5_000, 15_000, 30_000, 60_000, 120_000]
const VIS_STALE_MS = 45_000

const FRIENDLY = {
  Busy: 'Busy',
  Rejected: 'Declined',
  'Not Found': 'Number not found',
  Unavailable: 'Unavailable',
  'No Answer': 'No answer',
  Canceled: 'Cancelled',
  'Request Timeout': 'Timed out',
  'User Denied Media Access': 'Microphone access was blocked',
  'Connection Error': 'Connection lost',
  'Authentication Error': 'Envo refused the phone’s password',
  'Address Incomplete': 'Incomplete number',
  'Incompatible SDP': 'Audio negotiation failed',
  Terminated: 'Call ended',
  'WebRTC Error': 'Audio device error',
}
export const friendlyCause = (cause) => FRIENDLY[cause] ?? cause ?? 'Call ended'

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
const visible = () => typeof document !== 'undefined' && document.visibilityState === 'visible'

export class PhoneEngine {
  /**
   * @param {{ userId: string, extension: string, onNotice?: (kind: 'success'|'error'|'info', message: string) => void }} opts
   */
  constructor({ userId, extension, onNotice }) {
    this.userId = userId
    this.extension = extension
    this.onNotice = onNotice ?? (() => {})
    this.id = newId()
    this.role = 'starting'           // 'leader' | 'follower'
    this.shared = { reg: 'connecting', regError: '', call: null, leaderVisible: false }
    this.history = []
    this.micPermission = 'unknown'   // granted | denied | prompt | unknown
    this.listeners = new Set()
    this.snapshot = null

    this.tones = new Tones()
    this.ringing = false
    this.ua = null
    this.session = null
    this.creds = null
    this.audio = null
    this.pendingMeta = null
    this.visibleFollowers = new Map() // tab id → last seen visible (ms)
    this.retry = 0
    this.retryTimer = undefined
    this.stopped = false
    this.notification = null

    // localStorage['crm-phone-debug'] = '1' logs the phone's life and JsSIP's SIP traffic.
    try { this.debug = localStorage.getItem('crm-phone-debug') === '1' } catch { this.debug = false }
    this.lockName = `crm-phone:${userId}`
    this.historyKey = `crm-phone-history:${userId}`
    this.refresh()
  }

  // ── Store (useSyncExternalStore) ─────────────────────────────────────────────

  subscribe = (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getSnapshot = () => this.snapshot

  refresh() {
    this.snapshot = {
      role: this.role,
      reg: this.shared.reg,
      regError: this.shared.regError,
      call: this.shared.call,
      extension: this.extension,
      history: this.history,
      micPermission: this.micPermission,
      multiTab: !!this.channel,
    }
    for (const fn of this.listeners) fn()
  }

  log(...args) {
    if (this.debug) console.info('[phone]', this.id.slice(0, 8), this.role, ...args)
  }

  notice(kind, message, { local = false } = {}) {
    if (visible()) this.onNotice(kind, message)
    if (!local) this.post({ t: 'notice', kind, message })
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  start() {
    this.log('start')
    this.loadHistory()
    this.watchMicPermission()
    this.onVisibility = () => this.visibilityChanged()
    this.onUnlock = () => this.tones.unlock()
    this.onStorage = (e) => { if (e.key === this.historyKey) { this.loadHistory(); this.refresh() } }
    this.onPageHide = () => this.pageHide()
    this.onBeforeUnload = (e) => {
      if (this.role === 'leader' && this.session) { e.preventDefault(); e.returnValue = '' }
    }
    document.addEventListener('visibilitychange', this.onVisibility)
    document.addEventListener('pointerdown', this.onUnlock, true)
    document.addEventListener('keydown', this.onUnlock, true)
    window.addEventListener('storage', this.onStorage)
    window.addEventListener('pagehide', this.onPageHide)
    window.addEventListener('beforeunload', this.onBeforeUnload)

    const canShare = typeof BroadcastChannel !== 'undefined' && !!navigator.locks?.request
    if (!canShare) { this.becomeLeader(); return }

    this.channel = new BroadcastChannel(this.lockName)
    this.channel.onmessage = (e) => this.onMessage(e.data)
    this.role = 'follower'
    this.refresh()
    this.post({ t: 'hello', visible: visible() })
    this.lockAbort = new AbortController()
    navigator.locks.request(this.lockName, { signal: this.lockAbort.signal }, () => {
      if (this.stopped) return undefined
      return new Promise((resolve) => { this.releaseLock = resolve; this.becomeLeader() })
    }).catch(() => { /* aborted on stop */ })
    this.heartbeat = window.setInterval(() => {
      if (this.role === 'follower' && visible()) this.post({ t: 'vis', visible: true })
    }, 20_000)
  }

  stop() {
    this.log('stop')
    this.stopped = true
    window.clearTimeout(this.retryTimer)
    window.clearInterval(this.heartbeat)
    this.tones.stop()
    this.closeNotification()
    try { this.session?.terminate() } catch { /* already ending */ }
    try { this.ua?.stop() } catch { /* already stopped */ }
    this.ua = null
    this.session = null
    this.post({ t: 'bye' })
    this.lockAbort?.abort()
    this.releaseLock?.()
    this.channel?.close()
    this.channel = null
    document.removeEventListener('visibilitychange', this.onVisibility)
    document.removeEventListener('pointerdown', this.onUnlock, true)
    document.removeEventListener('keydown', this.onUnlock, true)
    window.removeEventListener('storage', this.onStorage)
    window.removeEventListener('pagehide', this.onPageHide)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
    this.listeners.clear()
  }

  pageHide() {
    this.post({ t: 'bye' })
    // Leaving mid-call: hang up properly so the other side isn't left talking to silence.
    if (this.role === 'leader') { try { this.session?.terminate() } catch { /* ending */ } }
  }

  // ── Between tabs ─────────────────────────────────────────────────────────────

  post(msg) {
    try { this.channel?.postMessage({ ...msg, from: this.id }) } catch { /* closed */ }
  }

  broadcast() {
    this.post({ t: 'state', state: this.shared })
  }

  onMessage(msg) {
    if (!msg || msg.from === this.id) return
    if (msg.t === 'notice') { if (visible()) this.onNotice(msg.kind, msg.message); return }
    if (this.role === 'leader') {
      if (msg.t === 'hello') { this.markFollower(msg.from, msg.visible); this.broadcast() }
      else if (msg.t === 'vis') this.markFollower(msg.from, msg.visible)
      else if (msg.t === 'bye') { this.visibleFollowers.delete(msg.from); this.updateRinging() }
      else if (msg.t === 'cmd') this.exec(msg.cmd, msg.args ?? {})
      return
    }
    // A tab just took the phone over: tell it whether this one is in view.
    if (msg.t === 'whois') { this.post({ t: 'vis', visible: visible() }); return }
    if (msg.t === 'state') {
      const first = !this.seenLeader
      this.seenLeader = true
      this.shared = msg.state
      if (first) this.post({ t: 'vis', visible: visible() })
      this.updateRinging()
      this.refresh()
    }
  }

  markFollower(id, isVisible) {
    if (isVisible) this.visibleFollowers.set(id, Date.now())
    else this.visibleFollowers.delete(id)
    this.updateRinging()
  }

  anyFollowerVisible() {
    const now = Date.now()
    for (const [id, at] of this.visibleFollowers) {
      if (now - at < VIS_STALE_MS) return true
      this.visibleFollowers.delete(id)
    }
    return false
  }

  visibilityChanged() {
    if (this.role === 'leader') this.setShared({ leaderVisible: visible() })
    else this.post({ t: 'vis', visible: visible() })
    this.updateRinging()
  }

  /** Ring in the tab the person can see; with none visible, in the phone's tab. */
  updateRinging() {
    const call = this.shared.call
    const ringingIn = call?.direction === 'incoming' && call.state === 'ringing'
    const should = ringingIn && (this.role === 'leader'
      ? visible() || !this.anyFollowerVisible()
      : visible() && !this.shared.leaderVisible)
    if (should && !this.ringing) { this.ringing = true; this.tones.startRingtone() }
    else if (!should && this.ringing) { this.ringing = false; this.tones.stop() }

    if (this.role === 'leader' && ringingIn && !visible() && !this.anyFollowerVisible()) this.showNotification(call)
    else if (!ringingIn) this.closeNotification()
  }

  showNotification(call) {
    if (this.notification || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    try {
      const who = call.label || call.name || call.display || call.number || 'Unknown caller'
      this.notification = new Notification('Incoming call', {
        body: call.label || call.name ? `${who} · ${call.display || call.number}` : who,
        tag: 'crm-phone-call', requireInteraction: true,
      })
      this.notification.onclick = () => { window.focus(); this.notification?.close() }
    } catch { this.notification = null }
  }

  closeNotification() {
    try { this.notification?.close() } catch { /* gone */ }
    this.notification = null
  }

  // ── Leader: registration ─────────────────────────────────────────────────────

  setShared(patch) {
    this.shared = { ...this.shared, ...patch }
    this.broadcast()
    this.updateRinging()
    this.refresh()
  }

  setCall(id, patch) {
    const c = this.shared.call
    if (c && c.id === id) this.setShared({ call: patch === null ? null : { ...c, ...patch } })
  }

  becomeLeader() {
    if (this.stopped) return
    this.role = 'leader'
    this.log('took the phone')
    this.visibleFollowers.clear()
    this.audio = new Audio()
    this.audio.autoplay = true
    this.audio.setAttribute('playsinline', '')
    this.post({ t: 'whois' })
    this.setShared({ reg: 'connecting', regError: '', call: null, leaderVisible: visible() })
    void this.connect()
  }

  async connect() {
    window.clearTimeout(this.retryTimer)
    if (this.stopped || this.role !== 'leader') return
    this.setShared({ reg: 'connecting', regError: '' })
    let creds
    try {
      const res = await fetch('/api/telephony/session', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        const err = new Error(j.error || `The phone could not start (${res.status})`)
        err.permanent = [403, 409, 422].includes(res.status)
        throw err
      }
      creds = j.data
    } catch (err) {
      this.failRegistration(err.message || 'Could not reach the CRM', err.permanent)
      return
    }
    if (this.stopped || this.role !== 'leader') return
    this.creds = creds

    let JsSIP
    try {
      const mod = await import('jssip')
      JsSIP = mod.default ?? mod
    } catch {
      this.failRegistration('The phone could not load; reload the page', true)
      return
    }
    // Stopped (signed out, page left) or handed over while loading: start nothing.
    if (this.stopped || this.role !== 'leader') return
    if (this.debug) JsSIP.debug.enable('JsSIP:*')
    else JsSIP.debug.disable()
    try { this.ua?.stop() } catch { /* old one */ }
    this.log('connecting to', creds.wsUrl, 'as', creds.username)

    const ua = new JsSIP.UA({
      sockets: [new JsSIP.WebSocketInterface(creds.wsUrl)],
      uri: `sip:${creds.username}@${creds.domain}`,
      password: creds.password,
      display_name: creds.displayName,
      register: true,
      register_expires: 300,
      session_timers: false,
      user_agent: 'Enfinito CRM Phone',
      connection_recovery_min_interval: 2,
      connection_recovery_max_interval: 30,
    })
    ua.on('connecting', () => { if (this.shared.reg !== 'registered') this.setShared({ reg: 'connecting' }) })
    ua.on('disconnected', () => { if (this.ua === ua) this.setShared({ reg: 'connecting' }) })
    ua.on('registered', () => { this.retry = 0; this.setShared({ reg: 'registered', regError: '' }) })
    ua.on('unregistered', () => { if (this.ua === ua && !this.stopped) this.setShared({ reg: 'connecting' }) })
    ua.on('registrationFailed', (e) => {
      if (this.ua !== ua) return
      // Start again from fresh credentials, waiting longer each time.
      try { ua.stop() } catch { /* stopping */ }
      this.ua = null
      this.failRegistration(friendlyCause(e?.cause ?? 'Registration failed'), false)
    })
    ua.on('newRTCSession', (e) => { this.log('new call', e.originator); this.attach(e.session, e.originator) })
    this.ua = ua
    ua.start()
  }

  failRegistration(message, permanent) {
    this.setShared({ reg: 'failed', regError: message })
    if (permanent || this.stopped) return
    const delay = RETRY_MS[Math.min(this.retry, RETRY_MS.length - 1)]
    this.retry += 1
    this.retryTimer = window.setTimeout(() => void this.connect(), delay)
  }

  // ── Leader: calls ────────────────────────────────────────────────────────────

  pcConfig() {
    return { iceServers: this.creds?.iceServers ?? [], rtcpMuxPolicy: 'require', bundlePolicy: 'max-bundle' }
  }

  attach(s, originator) {
    if (originator === 'remote' && this.session) {
      s.terminate({ status_code: 486, reason_phrase: 'Busy Here' })
      return
    }
    this.session = s
    const id = newId()
    const incoming = originator === 'remote'
    const number = s.remote_identity?.uri?.user ?? ''
    const name = s.remote_identity?.display_name ?? ''
    const meta = incoming ? {} : (this.pendingMeta ?? {})
    this.pendingMeta = null
    // Envo's click-to-call rings your own phone first, named "Envo call <number>".
    const callback = incoming && /^Envo call /.test(name)
    let answeredAt = null
    this.setShared({
      call: {
        id, direction: incoming ? 'incoming' : 'outgoing', number, name: callback ? '' : name,
        display: meta.display ?? null, label: meta.label ?? null, callback,
        state: incoming ? 'ringing' : 'dialing', startedAt: Date.now(), answeredAt: null,
        muted: false, held: false, endReason: null,
      },
    })

    const attachAudio = (pc) => {
      pc.addEventListener('track', (ev) => {
        if (this.audio && ev.streams[0]) {
          this.audio.srcObject = ev.streams[0]
          this.audio.play().catch(() => undefined)
        }
      })
    }
    s.on('peerconnection', (e) => attachAudio(e.peerconnection))
    if (s.connection) attachAudio(s.connection)

    // JsSIP waits for ICE gathering to finish; go as soon as a public candidate is known.
    let iceTimer
    s.on('icecandidate', (e) => {
      const type = e.candidate?.type
      window.clearTimeout(iceTimer)
      if (type === 'srflx' || type === 'relay') e.ready()
      else iceTimer = window.setTimeout(() => e.ready(), 1200)
    })

    s.on('progress', (e) => {
      if (incoming) return
      this.setCall(id, { state: 'progress' })
      if (e?.response?.status_code === 180) this.tones.startRingback()
      else this.tones.stop()
    })
    const onAnswered = () => {
      this.tones.stop()
      if (answeredAt === null) answeredAt = Date.now()
      this.setCall(id, { state: 'active', answeredAt })
    }
    s.on('accepted', onAnswered)
    s.on('confirmed', onAnswered)
    s.on('hold', (e) => { if (e.originator === 'local') this.setCall(id, { held: true }) })
    s.on('unhold', (e) => { if (e.originator === 'local') this.setCall(id, { held: false }) })
    s.on('muted', () => this.setCall(id, { muted: true }))
    s.on('unmuted', () => this.setCall(id, { muted: false }))

    const finish = (cause, failed) => {
      window.clearTimeout(iceTimer)
      if (this.session === s) this.session = null
      const wasAnswered = answeredAt !== null
      wasAnswered ? this.tones.hangup() : this.tones.stop()
      if (this.audio) this.audio.srcObject = null
      const c = this.shared.call?.id === id ? this.shared.call : null
      const status = wasAnswered ? 'answered'
        : incoming ? (cause === 'Rejected' ? 'declined' : 'missed')
          : cause === 'Canceled' ? 'cancelled' : 'failed'
      this.addHistory({
        id, direction: incoming ? 'incoming' : 'outgoing', number,
        display: c?.display ?? null, label: c?.label ?? null, name: c?.name || null,
        at: Date.now(), duration: wasAnswered ? Math.round((Date.now() - answeredAt) / 1000) : 0, status,
      })
      if (failed && !incoming && cause !== 'Canceled') this.notice('error', `Call failed: ${friendlyCause(cause)}`)
      this.setCall(id, { state: 'ended', endReason: wasAnswered ? null : friendlyCause(cause) })
      window.setTimeout(() => this.setCall(id, null), 2500)
    }
    s.on('ended', (e) => finish(e.cause, false))
    s.on('failed', (e) => finish(e.cause, true))
  }

  /** What a command does in the phone's tab. */
  exec(cmd, args) {
    const s = this.session
    switch (cmd) {
      case 'dial': {
        const target = dialable(args.number)
        if (!target) return this.notice('error', 'That is not a number to call')
        if (!this.ua || this.shared.reg !== 'registered') return this.notice('error', 'The phone is not connected to Envo yet')
        if (s) return this.notice('error', 'Finish the current call first')
        this.pendingMeta = { display: args.display ?? null, label: args.label ?? null }
        try {
          this.ua.call(`sip:${target}@${this.creds.domain}`, {
            mediaConstraints: { audio: true, video: false },
            pcConfig: this.pcConfig(),
            rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
          })
        } catch (err) {
          this.pendingMeta = null
          this.notice('error', `Could not call: ${err?.message ?? err}`)
        }
        return
      }
      case 'answer':
        if (!s || this.shared.call?.state !== 'ringing') return
        this.tones.stop()
        this.ringing = false
        try { s.answer({ mediaConstraints: { audio: true, video: false }, pcConfig: this.pcConfig() }) }
        catch (err) { this.notice('error', `Could not answer: ${err?.message ?? err}`) }
        return
      case 'hangup':
        if (!s) return
        try {
          if (s.isInProgress() && s.direction === 'incoming') s.terminate({ status_code: 486, reason_phrase: 'Busy Here' })
          else s.terminate()
        } catch { this.session = null; this.setShared({ call: null }) }
        return
      case 'mute':
        if (s) s.isMuted().audio ? s.unmute({ audio: true }) : s.mute({ audio: true })
        return
      case 'hold':
        if (s) s.isOnHold().local ? s.unhold() : s.hold()
        return
      case 'dtmf':
        if (s?.isEstablished() && /^[0-9*#]$/.test(args.digit ?? '')) {
          s.sendDTMF(args.digit, { transportType: 'RFC2833', duration: 120, interToneGap: 70 })
        }
        return
      case 'transfer': {
        const to = dialable(args.to)
        if (!s || !to || !this.creds) return
        s.refer(`sip:${to}@${this.creds.domain}`, {
          eventHandlers: {
            accepted: () => this.notice('success', `Transferred to ${args.display || to}`),
            failed: () => this.notice('error', 'The transfer did not go through'),
          },
        })
        return
      }
      case 'label':
        if (this.shared.call?.id === args.id && args.label && !this.shared.call.label) this.setCall(args.id, { label: String(args.label).slice(0, 120) })
        return
      case 'reconnect':
        this.retry = 0
        void this.connect()
        return
      default:
    }
  }

  // ── Actions (any tab) ────────────────────────────────────────────────────────

  send(cmd, args = {}) {
    if (this.role === 'leader') this.exec(cmd, args)
    else this.post({ t: 'cmd', cmd, args })
  }

  /** The microphone, asked for in this tab (which the person is looking at), once. */
  async ensureMic() {
    if (this.micPermission === 'granted') return true
    if (!navigator.mediaDevices?.getUserMedia) {
      this.notice('error', 'This browser cannot use a microphone here (it needs HTTPS)', { local: true })
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
      this.micPermission = 'granted'
      this.refresh()
      return true
    } catch (err) {
      this.micPermission = err?.name === 'NotAllowedError' ? 'denied' : this.micPermission
      this.refresh()
      this.notice('error', err?.name === 'NotAllowedError'
        ? 'The microphone is blocked: allow it for this site in the browser’s address bar'
        : 'No microphone was found', { local: true })
      return false
    }
  }

  async dial(number, meta = {}) {
    this.tones.unlock()
    if (!(await this.ensureMic())) return false
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    this.send('dial', { number, display: meta.display ?? null, label: meta.label ?? null })
    return true
  }

  async answer() {
    this.tones.unlock()
    if (!(await this.ensureMic())) return
    this.send('answer')
  }

  hangup() { this.send('hangup') }
  toggleMute() { this.send('mute') }
  toggleHold() { this.send('hold') }
  transfer(to, display) { this.send('transfer', { to, display }) }
  reconnect() { this.send('reconnect') }
  setLabel(id, label) { if (id && label) this.send('label', { id, label }) }

  dtmf(digit) {
    this.tones.dtmf(digit)
    this.send('dtmf', { digit })
  }

  // ── Recent calls (this browser) ──────────────────────────────────────────────

  loadHistory() {
    try { this.history = JSON.parse(localStorage.getItem(this.historyKey) ?? '[]') } catch { this.history = [] }
    if (!Array.isArray(this.history)) this.history = []
  }

  addHistory(entry) {
    this.loadHistory()
    this.history = [entry, ...this.history.filter(h => h.id !== entry.id)].slice(0, HISTORY_MAX)
    try { localStorage.setItem(this.historyKey, JSON.stringify(this.history)) } catch { /* storage full */ }
    this.refresh()
  }

  clearHistory() {
    this.history = []
    try { localStorage.removeItem(this.historyKey) } catch { /* */ }
    this.refresh()
  }

  async watchMicPermission() {
    try {
      const st = await navigator.permissions?.query({ name: 'microphone' })
      if (!st) return
      this.micPermission = st.state
      st.onchange = () => { this.micPermission = st.state; this.refresh() }
      this.refresh()
    } catch { /* not supported: asked on first call */ }
  }
}
