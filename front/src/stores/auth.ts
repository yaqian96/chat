import { computed, ref } from 'vue'

const TOKEN_KEY = 'membot_access_token'
const USER_KEY = 'membot_user'

export interface AuthUser {
  id: string
  email: string
}

function loadUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export const accessToken = ref(localStorage.getItem(TOKEN_KEY) ?? '')
export const currentUser = ref<AuthUser | null>(loadUser())

export const isAuthenticated = computed(
  () => !!accessToken.value && !!currentUser.value,
)

export function getAccessToken(): string {
  return accessToken.value
}

export function setAuth(token: string, user: AuthUser) {
  accessToken.value = token
  currentUser.value = user
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearAuth() {
  accessToken.value = ''
  currentUser.value = null
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function authHeaders(): Record<string, string> {
  const token = accessToken.value
  return token ? { Authorization: `Bearer ${token}` } : {}
}
