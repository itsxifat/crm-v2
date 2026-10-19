import {
  Landmark, PiggyBank, Banknote, Coins, Smartphone, CreditCard, Globe, HandCoins, CircleDollarSign,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { accountColor, accountIconKey, withAlpha } from './accountTheme'

const ICONS = {
  bank:    Landmark,
  savings: PiggyBank,
  cash:    Banknote,
  petty:   Coins,
  wallet:  Smartphone,
  card:    CreditCard,
  gateway: Globe,
  loan:    HandCoins,
  other:   CircleDollarSign,
}

const SIZES = {
  xs: { box: 'w-7 h-7 rounded-lg',  icon: 'w-3.5 h-3.5' },
  sm: { box: 'w-9 h-9 rounded-lg',  icon: 'w-4 h-4' },
  md: { box: 'w-11 h-11 rounded-xl', icon: 'w-5 h-5' },
  lg: { box: 'w-14 h-14 rounded-2xl', icon: 'w-6 h-6' },
}

/** Tinted icon tile for a money account (brand-ish colour, icon by type). */
export default function AccountIcon({ account, type, size = 'md', className }) {
  const acc = account ?? { type }
  const key = acc.type === 'BANK_SAVINGS' ? 'savings' : accountIconKey(acc.type)
  const Icon = ICONS[key] ?? CircleDollarSign
  const color = accountColor(acc)
  const s = SIZES[size] ?? SIZES.md
  return (
    <span
      className={cn('inline-flex items-center justify-center shrink-0', s.box, className)}
      style={{ backgroundColor: withAlpha(color, 0.12), color }}
      aria-hidden="true"
    >
      <Icon className={s.icon} />
    </span>
  )
}
