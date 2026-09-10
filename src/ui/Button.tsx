import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'text' | 'chip' | 'solid'

const VARIANT: Record<Variant, string> = {
  primary: 'h-[46px] w-full rounded-[12px] bg-accent text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(179,27,27,0.25)] disabled:opacity-50 disabled:shadow-none',
  secondary: 'h-[46px] w-full rounded-[12px] border-[1.5px] border-line bg-card text-[15px] font-bold text-fg',
  text: 'text-[12px] font-semibold text-fg-2 hover:text-fg',
  chip: 'shrink-0 whitespace-nowrap rounded-full bg-accent-soft px-3 py-1 text-[12px] font-semibold text-accent',
  /** The button of a bubble: solid on the bubble's tinted ground */
  solid: 'shrink-0 whitespace-nowrap rounded-full bg-accent px-3.5 py-1.5 text-[12px] font-bold text-white',
}

export function Button({ variant, children, className = '', ...rest }: { variant: Variant; children: ReactNode; className?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`inline-flex cursor-pointer items-center justify-center gap-2 disabled:cursor-default ${VARIANT[variant]} ${className}`} {...rest}>
      {children}
    </button>
  )
}
