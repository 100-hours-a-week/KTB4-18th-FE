import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpeechTranscriptionError, transcribeAudio } from '../api/speechTranscriptions'
import { useVoiceInput } from './useVoiceInput'

vi.mock('../api/speechTranscriptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/speechTranscriptions')>()),
  transcribeAudio: vi.fn(),
}))

class FakeMediaRecorder {
  static isTypeSupported() {
    return true
  }

  readonly mimeType: string
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: (() => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'audio/webm'
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['recording'], { type: this.mimeType }) } as BlobEvent)
    this.onstop?.()
  }
}

describe('useVoiceInput', () => {
  const stopTrack = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('일시적인 전사 실패 후 같은 녹음으로 재시도한다', async () => {
    vi.mocked(transcribeAudio)
      .mockRejectedValueOnce(new SpeechTranscriptionError('일시적인 오류', 502, true))
      .mockResolvedValueOnce('비 오는 날 드라이브 음악')
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceInput({ onTranscript }))

    await act(async () => result.current.startRecording())
    expect(result.current.isRecording).toBe(true)

    act(() => result.current.stopRecording())
    await waitFor(() => expect(result.current.canRetry).toBe(true))
    expect(result.current.error).toBe('일시적인 오류')

    act(() => result.current.retryTranscription())
    await waitFor(() => expect(result.current.status).toBe('reviewing'))

    expect(transcribeAudio).toHaveBeenCalledTimes(2)
    expect(onTranscript).toHaveBeenCalledWith('비 오는 날 드라이브 음악')
    expect(stopTrack).toHaveBeenCalled()
  })
})
