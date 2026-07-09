import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * useVoice — browser-native Speech Recognition + Speech Synthesis.
 *
 * STT: window.SpeechRecognition (Chrome / Edge / Safari)
 * TTS: window.speechSynthesis   (all modern browsers)
 *
 * No API keys or extra packages needed.
 */
export function useVoice() {
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking]   = useState(false)
  const [supported, setSupported]     = useState({ stt: false, tts: false })
  const recognitionRef                = useRef(null)
  const utteranceRef                  = useRef(null)

  // Detect support on mount
  useEffect(() => {
    setSupported({
      stt: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      tts: !!window.speechSynthesis,
    })
    // Cancel any lingering speech on unmount
    return () => window.speechSynthesis?.cancel()
  }, [])

  /** Start listening. Calls onResult(transcript) on success. */
  const startListening = useCallback((onResult, onError) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      onError?.('Speech recognition is not supported in this browser. Use Chrome or Edge.')
      return
    }

    const rec = new SR()
    rec.lang             = 'en-US'
    rec.interimResults   = false
    rec.maxAlternatives  = 1
    rec.continuous       = false

    rec.onstart  = () => setIsListening(true)
    rec.onend    = () => setIsListening(false)
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim()
      if (transcript) onResult(transcript)
    }
    rec.onerror  = (e) => {
      setIsListening(false)
      if (e.error !== 'no-speech') onError?.(e.error)
    }

    recognitionRef.current = rec
    rec.start()
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  /**
   * Speak text aloud.
   * @param {string} text
   * @param {object} opts  rate (0.1–10), pitch (0–2)
   */
  const speak = useCallback((text, { rate = 0.92, pitch = 1.0 } = {}) => {
    if (!window.speechSynthesis || !text) return

    window.speechSynthesis.cancel()

    const utt    = new SpeechSynthesisUtterance(text)
    utt.lang     = 'en-US'
    utt.rate     = rate
    utt.pitch    = pitch
    utt.onstart  = () => setIsSpeaking(true)
    utt.onend    = () => setIsSpeaking(false)
    utt.onerror  = () => setIsSpeaking(false)

    utteranceRef.current = utt
    window.speechSynthesis.speak(utt)
  }, [])

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel()
    setIsSpeaking(false)
  }, [])

  return {
    isListening,
    isSpeaking,
    supported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  }
}
