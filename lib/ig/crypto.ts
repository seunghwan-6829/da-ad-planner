// 토큰 암호화(AES-256-GCM). TOKEN_ENC_KEY(임의 문자열)를 sha256으로 32바이트 키로 파생.
// 저장 포맷: base64(iv).base64(authTag).base64(ciphertext)  — 서버 전용.
import crypto from 'crypto'

function key(): Buffer {
  const secret = process.env.TOKEN_ENC_KEY
  if (!secret) throw new Error('TOKEN_ENC_KEY 가 설정되지 않았습니다.')
  return crypto.createHash('sha256').update(secret).digest() // 32 bytes
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`
}

export function decryptToken(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('손상된 토큰 형식')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
