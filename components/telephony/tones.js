// Call progress tones synthesised with WebAudio, no audio files (as Envo's own web phone,
// envo/web/src/phone/tones.ts). Browsers keep audio off until the person has clicked in
// the tab: unlock() from a click or key press turns it on for the rest of the visit.

const DTMF = {
  1: [697, 1209], 2: [697, 1336], 3: [697, 1477],
  4: [770, 1209], 5: [770, 1336], 6: [770, 1477],
  7: [852, 1209], 8: [852, 1336], 9: [852, 1477],
  '*': [941, 1209], 0: [941, 1336], '#': [941, 1477],
}

export class Tones {
  constructor() {
    this.ctx = null
    this.loop = undefined
    this.active = []
  }

  context() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? window.webkitAudioContext
      if (!Ctor) return null
      this.ctx = new Ctor()
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined)
    return this.ctx
  }

  /** From a click or key press: lets tones play later, even with the tab in the background. */
  unlock() {
    try { this.context() } catch { /* no audio */ }
  }

  play(freqs, seconds, volume = 0.07, delay = 0) {
    const ctx = this.context()
    if (!ctx) return
    const gain = ctx.createGain()
    const start = ctx.currentTime + delay
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(volume, start + 0.01)
    gain.gain.setValueAtTime(volume, start + seconds - 0.02)
    gain.gain.linearRampToValueAtTime(0, start + seconds)
    gain.connect(ctx.destination)
    for (const f of freqs) {
      const osc = ctx.createOscillator()
      osc.frequency.value = f
      osc.connect(gain)
      osc.start(start)
      osc.stop(start + seconds)
      this.active.push(osc)
      osc.onended = () => { this.active = this.active.filter(o => o !== osc) }
    }
  }

  /** Incoming call: a double ring every 3 s. */
  startRingtone() {
    this.stop()
    const ring = () => {
      this.play([440, 480], 0.4, 0.09)
      this.play([440, 480], 0.4, 0.09, 0.6)
    }
    ring()
    this.loop = window.setInterval(ring, 3000)
  }

  /** Outgoing call waiting to be answered. */
  startRingback() {
    this.stop()
    const tone = () => this.play([440, 480], 1.8, 0.05)
    tone()
    this.loop = window.setInterval(tone, 5000)
  }

  dtmf(digit) {
    const pair = DTMF[digit]
    if (pair) this.play(pair, 0.12, 0.05)
  }

  hangup() {
    this.stop()
    this.play([480, 620], 0.25, 0.05)
    this.play([480, 620], 0.25, 0.05, 0.5)
  }

  stop() {
    window.clearInterval(this.loop)
    this.loop = undefined
    for (const osc of this.active) {
      try { osc.stop() } catch { /* already stopped */ }
    }
    this.active = []
  }
}
