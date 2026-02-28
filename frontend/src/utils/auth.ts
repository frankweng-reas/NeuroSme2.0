/** 固定登入使用者（mock，登入整合後改由 AuthContext 提供） */
export const CURRENT_USER_EMAIL = 'test01@test.com'

export function getCurrentUserEmail(): string {
  return CURRENT_USER_EMAIL
}
