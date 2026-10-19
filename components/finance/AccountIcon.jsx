import {
  Landmark, PiggyBank, Banknote, Coins, Smartphone, CreditCard, Globe, HandCoins, CircleDollarSign,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { accountColor, accountIconKey } from './accountTheme'

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
  xs: { box: 'size-7 rounded-md',  icon: 'size-3.5' },
  sm: { box: 'size-8 rounded-lg',  icon: 'size-4' },
  md: { box: 'size-9 rounded-lg',  icon: 'size-4' },
  lg: { box: 'size-11 rounded-xl', icon: 'size-5' },
}

/** Neutral icon tile for a money account; the icon carries the account's identity colour. */
export default function AccountIcon({ account, type, size = 'md', className }) {
  const acc = account ?? { type }
  const key = acc.type === 'BANK_SAVINGS' ? 'savings' : accountIconKey(acc.type)
  const Icon = ICONS[key] ?? CircleDollarSign
  const color = accountColor(acc)
  const s = SIZES[size] ?? SIZES.md
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center border border-gray-200/80 bg-white shadow-xs',
        s.box,
        className,
      )}
      style={{ color }}
      aria-hidden="true"
    >
      <Icon className={s.icon} />
    </span>
  )
}
