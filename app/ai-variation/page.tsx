'use client'

import { useState } from 'react'
import { Sparkles, Upload, Copy, Check, Plus, Minus, Loader2, FileText, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

export default function AIVariationPage() {
  const [originalScript, setOriginalScript] = useState('')
  const [productName, setProductName] = useState('')
  const [appeals, setAppeals] = useState<string[]>([''])
  const [variationResult, setVariationResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // SRT 파일 파싱 함수
  function parseSRT(content: string): string {
    const lines = content.split('\n')
    const textLines: string[] = []
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      // 숫자만 있는 줄 (시퀀스 번호) 스킵
      if (/^\d+$/.test(line)) continue
      // 타임코드 줄 스킵
      if (/^\d{2}:\d{2}:\d{2}/.test(line)) continue
      // 빈 줄 스킵
      if (!line) continue
      // 나머지는 대사
      textLines.push(line)
    }
    
    return textLines.join('\n')
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (text) {
        // SRT 파일이면 파싱, 아니면 그대로
        if (file.name.endsWith('.srt')) {
          setOriginalScript(parseSRT(text))
        } else {
          setOriginalScript(text)
        }
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function addAppeal() {
    setAppeals(prev => [...prev, ''])
  }

  function removeAppeal(index: number) {
    if (appeals.length <= 1) return
    setAppeals(prev => prev.filter((_, i) => i !== index))
  }

  function updateAppeal(index: number, value: string) {
    setAppeals(prev => prev.map((a, i) => i === index ? value : a))
  }

  async function generateVariation() {
    if (!originalScript.trim()) {
      alert('원본 대본을 입력해주세요.')
      return
    }

    setLoading(true)
    setVariationResult('')

    try {
      const validAppeals = appeals.filter(a => a.trim())
      
      const res = await fetch('/api/ai/srt-variation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalScript: originalScript.trim(),
          productName: productName.trim(),
          appeals: validAppeals,
        }),
      })

      if (!res.ok) throw new Error('API 오류')

      const data = await res.json()
      setVariationResult(data.variation || '')
    } catch (error) {
      console.error('베리에이션 실패:', error)
      alert('베리에이션 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(variationResult)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Sparkles className="h-8 w-8 text-purple-500" />
          AI 베리에이션
        </h1>
        <p className="text-muted-foreground mt-1">
          기존 대본을 업로드하면 AI가 비슷한 스타일로 베리에이션을 만들어줍니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* 왼쪽: 입력 */}
        <div className="space-y-4">
          {/* 원본 대본 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                원본 대본
              </CardTitle>
              <CardDescription>
                SRT 파일을 업로드하거나 직접 입력하세요
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="file"
                  accept=".srt,.txt"
                  className="hidden"
                  id="srt-upload"
                  onChange={handleFileUpload}
                />
                <Button
                  variant="outline"
                  onClick={() => document.getElementById('srt-upload')?.click()}
                  className="flex-1"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  SRT/TXT 파일 업로드
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setOriginalScript('')}
                  disabled={!originalScript}
                >
                  초기화
                </Button>
              </div>
              <Textarea
                placeholder="대본 내용을 입력하세요...&#10;&#10;예:&#10;안녕하세요&#10;오늘 소개할 제품은...&#10;지금 바로 구매하세요!"
                rows={12}
                value={originalScript}
                onChange={(e) => setOriginalScript(e.target.value)}
              />
              {originalScript && (
                <p className="text-xs text-muted-foreground">
                  {originalScript.split('\n').length}줄, {originalScript.length}자
                </p>
              )}
            </CardContent>
          </Card>

          {/* 제품명 & 소구점 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">제품 정보</CardTitle>
              <CardDescription>
                AI가 베리에이션 시 참고할 정보입니다
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>제품명</Label>
                <Input
                  placeholder="예: 라비업 볼륨 넥크림"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>소구점</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addAppeal}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {appeals.map((appeal, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder={`소구점 ${index + 1} (예: 2주 만에 탄력 UP)`}
                      value={appeal}
                      onChange={(e) => updateAppeal(index, e.target.value)}
                    />
                    {appeals.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeAppeal(index)}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 생성 버튼 */}
          <Button
            onClick={generateVariation}
            disabled={loading || !originalScript.trim()}
            className="w-full bg-purple-600 hover:bg-purple-700"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                베리에이션 생성 중...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                AI 베리에이션 생성
              </>
            )}
          </Button>
        </div>

        {/* 오른쪽: 결과 */}
        <div>
          <Card className={variationResult ? 'border-purple-200 bg-purple-50' : ''}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                  베리에이션 결과
                </CardTitle>
                {variationResult && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={generateVariation}
                      disabled={loading}
                    >
                      <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                      다시 생성
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyToClipboard}
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4 mr-1 text-green-600" />
                          복사됨
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-1" />
                          복사
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-purple-600 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      AI가 베리에이션을 생성하고 있습니다...
                    </p>
                  </div>
                </div>
              ) : variationResult ? (
                <div className="bg-white rounded-lg p-4 border">
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 max-h-[500px] overflow-y-auto">
                    {variationResult}
                  </pre>
                </div>
              ) : (
                <div className="flex items-center justify-center py-20 text-center">
                  <div>
                    <Sparkles className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-muted-foreground">
                      원본 대본을 입력하고<br />
                      베리에이션을 생성해보세요
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
