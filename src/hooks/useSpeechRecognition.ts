import { useState, useEffect, useCallback } from 'react';

// 类型定义兼容
interface IWindow extends Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
}

export function useSpeechRecognition() {
    const [isSupported, setIsSupported] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [error, setError] = useState<string | null>(null);

    // 保持对 recognition 实例的引用
    const [recognition, setRecognition] = useState<any>(null);

    useEffect(() => {
        const { SpeechRecognition, webkitSpeechRecognition } = window as unknown as IWindow;
        const SpeechRecognitionAPI = SpeechRecognition || webkitSpeechRecognition;

        if (SpeechRecognitionAPI) {
            setIsSupported(true);
            const recog = new SpeechRecognitionAPI();

            recog.continuous = true; // 连续不断地识别
            recog.interimResults = true; // 返回临时中间结果
            recog.lang = 'zh-CN'; // 设定语言

            recog.onstart = () => {
                setIsListening(true);
                setError(null);
            };

            recog.onresult = (event: any) => {
                let finalTranscripts = '';
                let interimTranscripts = '';

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscripts += transcript;
                    } else {
                        interimTranscripts += transcript;
                    }
                }

                // 临时结果优先展示，如果有最终结果也拼接上
                setTranscript(finalTranscripts + interimTranscripts);
            };

            recog.onerror = (event: any) => {
                console.error('Speech recognition error', event.error);
                setIsListening(false);
                if (event.error === 'not-allowed') {
                    setError('麦克风权限被拒绝，请去设置中开启');
                } else {
                    setError(`识别出错: ${event.error}`);
                }
            };

            recog.onend = () => {
                setIsListening(false);
            };

            setRecognition(recog);
        } else {
            setIsSupported(false);
        }
    }, []);

    const startListening = useCallback(() => {
        if (recognition && !isListening) {
            try {
                setTranscript(''); // 每次重新开始清空
                setError(null);
                recognition.start();
            } catch (e) {
                console.warn('Recognition start failed', e);
                setIsListening(false);
            }
        }
    }, [recognition, isListening]);

    const stopListening = useCallback(() => {
        if (recognition && isListening) {
            try {
                recognition.stop();
            } catch (e) {
                console.warn('Recognition stop failed', e);
            }
        }
    }, [recognition, isListening]);

    return {
        isSupported,
        isListening,
        transcript,
        error,
        startListening,
        stopListening
    };
}
