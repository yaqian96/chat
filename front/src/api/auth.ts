import type { AuthUser } from '@/stores/auth'
import { authHeaders, clearAuth, setAuth } from '@/stores/auth'

export interface AuthResponse {
  accessToken: string
  user: AuthUser
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...options?.headers,
    },
    ...options,
  })

  if (res.status === 401) {
    clearAuth()
    throw new Error('登录已过期，请重新登录')
  }

  if (!res.ok) {
    const text = await res.text()
    let message = text || `Request failed: ${res.status}`
    try {
      const json = JSON.parse(text) as { message?: string | string[] }
      if (json.message) {
        message = Array.isArray(json.message)
          ? json.message.join(', ')
          : json.message
      }
    } catch {
      // keep raw text
    }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}

export const authApi = {
  register(email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }).then((data) => {
      setAuth(data.accessToken, data.user)
      return data
    })
  },

  login(email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }).then((data) => {
      setAuth(data.accessToken, data.user)
      return data
    })
  },

  me(): Promise<AuthUser> {
    return request<AuthUser>('/auth/me')
  },
}
