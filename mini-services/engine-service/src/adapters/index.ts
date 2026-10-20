import type { SiteAdapter } from '../types'
import { shuba69 } from './shuba69'
import { xbiquge } from './xbiquge'
import { novel543 } from './novel543'
import { hjwzw } from './hjwzw'
import { truyenfull } from './truyenfull'

export const ADAPTERS: SiteAdapter[] = [shuba69, xbiquge, novel543, hjwzw, truyenfull]

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Find the adapter handling a URL (by hostname). */
export function detectAdapter(url: string): SiteAdapter | null {
  const host = hostOf(url)
  if (!host) return null
  const bare = host.replace(/^www\./, '')
  for (const adapter of ADAPTERS) {
    if (adapter.hosts.includes(host) || adapter.hosts.includes(bare)) return adapter
  }
  return null
}

export function adapterById(id: string): SiteAdapter | null {
  return ADAPTERS.find((a) => a.id === id) ?? null
}
