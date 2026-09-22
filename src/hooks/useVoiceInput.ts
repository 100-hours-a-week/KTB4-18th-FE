import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeAudio } from '../api/speechTranscriptions'

const MAX_AUDIO_SIZE = 10 * 1024 * 1024
const MAX_RECORDING_SECONDS = 60
const SUPPORTED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
]

export type VoiceStatus =
  | 'idle'
  | 'requestingPermission'
  | 'recording'
  | 'transcribing'
  | 'reviewing'

interface UseVoiceInputOptions {
  onTranscript: (transcript: string) => void
}

function supportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  return SUPPORTED_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? null
}

function extensionFor(mimeType: string) {
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

export function useVoiceInput({ onTranscript }: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const shouldTranscribeRef = useRef(false)
  const intervalRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const transcriptionRequestRef = useRef<AbortController | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const mountedRef = useRef(true)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  const clearTimers = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current)
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    intervalRef.current = null
    timeoutRef.current = null
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const releaseRecording = useCallback(() => {
    clearTimers()
    stopStream()
    recorderRef.current = null
    setElapsedSeconds(0)
  }, [clearTimers, stopStream])

  const sendForTranscription = useCallback(async (blob: Blob, mimeType: string) => {
    if (blob.size === 0) {
      setError('녹음된 음성이 없습니다. 다시 녹음해 주세요.')
      setStatus('idle')
      return
    }
    if (blob.size > MAX_AUDIO_SIZE) {
      setError('음성 파일이 10MB를 초과했습니다. 더 짧게 녹음해 주세요.')
      setStatus('idle')
      return
    }

    const controller = new AbortController()
    transcriptionRequestRef.current = controller
    setStatus('transcribing')
    try {
      const file = new File([blob], `voice-${Date.now()}.${extensionFor(mimeType)}`, {
        type: mimeType,
      })
      const transcript = await transcribeAudio(file, controller.signal)
      if (!mountedRef.current || controller.signal.aborted) return
      onTranscriptRef.current(transcript)
      setStatus('reviewing')
    } catch (caught) {
      if (!controller.signal.aborted && mountedRef.current) {
        setError(caught instanceof Error ? caught.message : '음성을 변환하지 못했습니다.')
        setStatus('idle')
      }
    } finally {
      if (transcriptionRequestRef.current === controller) {
        transcriptionRequestRef.current = null
      }
    }
  }, [])

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    shouldTranscribeRef.current = true
    recorder.stop()
  }, [])

  const cancelRecording = useCallback(() => {
    const recorder = recorderRef.current
    shouldTranscribeRef.current = false
    transcriptionRequestRef.current?.abort()
    transcriptionRequestRef.current = null
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      return
    }
    releaseRecording()
    setStatus('idle')
  }, [releaseRecording])

  const startRecording = useCallback(async () => {
    if (status === 'recording' || status === 'transcribing' || status === 'requestingPermission') return

    const mimeType = supportedMimeType()
    if (!navigator.mediaDevices?.getUserMedia || !mimeType) {
      setError('이 브라우저에서는 WebM 또는 MP4 음성 녹음을 지원하지 않습니다.')
      return
    }

    setError('')
    setStatus('requestingPermission')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const recorder = new MediaRecorder(stream, { mimeType })
      streamRef.current = stream
      recorderRef.current = recorder
      chunksRef.current = []
      shouldTranscribeRef.current = false
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        shouldTranscribeRef.current = false
        setError('녹음을 진행하지 못했습니다. 마이크 설정을 확인해 주세요.')
      }
      recorder.onstop = () => {
        const shouldTranscribe = shouldTranscribeRef.current
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType })
        chunksRef.current = []
        releaseRecording()
        if (shouldTranscribe) {
          void sendForTranscription(blob, recorder.mimeType || mimeType)
        } else if (mountedRef.current) {
          setStatus('idle')
        }
      }

      const startedAt = Date.now()
      recorder.start(1_000)
      setElapsedSeconds(0)
      setStatus('recording')
      intervalRef.current = window.setInterval(() => {
        setElapsedSeconds(Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - startedAt) / 1_000)))
      }, 250)
      timeoutRef.current = window.setTimeout(stopRecording, MAX_RECORDING_SECONDS * 1_000)
    } catch (caught) {
      releaseRecording()
      setStatus('idle')
      if (caught instanceof DOMException && caught.name === 'NotAllowedError') {
        setError('마이크 권한이 필요합니다. 브라우저 설정에서 권한을 허용해 주세요.')
      } else {
        setError('마이크를 사용할 수 없습니다. 연결 상태와 브라우저 설정을 확인해 주세요.')
      }
    }
  }, [releaseRecording, sendForTranscription, status, stopRecording])

  const finishReview = useCallback(() => {
    setStatus('idle')
    setError('')
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      shouldTranscribeRef.current = false
      transcriptionRequestRef.current?.abort()
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      clearTimers()
      stopStream()
    }
  }, [clearTimers, stopStream])

  return {
    status,
    elapsedSeconds,
    error,
    isRecording: status === 'recording',
    isTranscribing: status === 'transcribing' || status === 'requestingPermission',
    startRecording,
    stopRecording,
    cancelRecording,
    finishReview,
  }
}
