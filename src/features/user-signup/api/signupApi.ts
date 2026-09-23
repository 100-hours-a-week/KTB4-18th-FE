export type SignupPayload = {
  email: string
  password: string
  nickname: string
  birth_year?: number
  gender?: 'MALE' | 'FEMALE'
  terms_ids: number[]
}

type SignupSuccess = {
  message: 'register success'
  data: { user_id: number }
}

type SignupFailure = {
  message: 'invalid request' | 'email already exists' | 'internal server error'
  data: null
}

export async function signup(payload: SignupPayload): Promise<SignupSuccess> {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/users/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json()) as SignupSuccess | SignupFailure

  if (!response.ok) {
    throw new Error(body.message)
  }
  return body as SignupSuccess
}
