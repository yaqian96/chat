export interface AuthUser {
  id: string
  email: string
}

export interface JwtPayload {
  sub: string
  email: string
}

export interface AuthResponse {
  accessToken: string
  user: AuthUser
}
