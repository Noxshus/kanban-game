import type { Ticket, TicketComplexity } from './types'

// Provisional technical-complexity balance, not T-shirt effort sizing.
export const COMPLEXITY_MULTIPLIERS: Readonly<Record<TicketComplexity, number>> = {
  S: 1, M: 1.5, L: 2, XL: 3, XXL: 5,
}

export function getTicketComplexity(ticket: Pick<Ticket, 'complexity'>): TicketComplexity {
  // Default without rewriting saved tickets or changing their previous rates.
  const complexity = ticket.complexity === undefined ? 'S' : ticket.complexity
  if (typeof complexity !== 'string' || !Object.hasOwn(COMPLEXITY_MULTIPLIERS, complexity)) {
    throw new RangeError('Ticket complexity must be S, M, L, XL or XXL')
  }
  return complexity
}

export function getComplexityMultiplier(ticket: Pick<Ticket, 'complexity'>): number {
  return COMPLEXITY_MULTIPLIERS[getTicketComplexity(ticket)]
}
