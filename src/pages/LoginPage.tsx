import { useEffect, useState } from 'react';
import { ArrowRight, Mail, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthRequestError, sendEmailCode, verifyEmailCode } from '@/services/authService';

interface LoginPageProps {
  onLogin: (email: string) => void;
}

const AVATAR_OPTIONS = [
  '/avatars/user_1.png',
  '/avatars/user_2.png',
  '/avatars/user_3.png',
  '/avatars/user_4.png',
  '/avatars/user_5.png',
  '/avatars/user_6.png',
];

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [step, setStep] = useState<'email' | 'avatar'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [selectedAvatar, setSelectedAvatar] = useState<string>('');
  const [verifiedEmail, setVerifiedEmail] = useState('');
  const [hintMessage, setHintMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [devCode, setDevCode] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (countdown <= 0) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [countdown]);

  const handleGetCode = async () => {
    if (!email || countdown > 0 || isSending) {
      return;
    }

    try {
      setIsSending(true);
      setErrorMessage('');
      const result = await sendEmailCode(email.trim().toLowerCase());
      setHintMessage(`验证码已发送至 ${result.masked_email}`);
      setDevCode(result.dev_code || '');
      setCountdown(result.cooldown_seconds || 60);
    } catch (error: any) {
      setHintMessage('');
      setDevCode('');
      if (error instanceof AuthRequestError && (error.code === 'auth_not_configured' || error.code === 'email_delivery_unconfigured')) {
        setErrorMessage('验证码暂时发送失败，请稍后再试。');
      } else {
        setErrorMessage(error.message || '验证码发送失败，请稍后重试');
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !code || isVerifying) {
      return;
    }

    try {
      setIsVerifying(true);
      setErrorMessage('');
      const result = await verifyEmailCode(email.trim().toLowerCase(), code);
      setVerifiedEmail(result.user.email);
      setHintMessage('');
      setStep('avatar');
    } catch (error: any) {
      setErrorMessage(error.message || '验证码校验失败，请重试');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleAvatarSelect = (avatar: string) => {
    setSelectedAvatar(avatar);
    localStorage.setItem('wanma_avatar', avatar);
    onLogin(verifiedEmail || email.trim().toLowerCase());
  };

  if (step === 'avatar') {
    return (
      <div className="min-h-screen bg-[#FFF9F0] flex flex-col items-center justify-center px-6 py-8 safe-top safe-bottom">
        {/* Title */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-black text-black tracking-tight">选择你的头像</h1>
          <p className="text-sm text-gray-500 mt-2">验证通过，选一个代表你的形象吧</p>
        </div>

        {/* Avatar Grid */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {AVATAR_OPTIONS.map((avatar, index) => (
            <button
              key={index}
              onClick={() => handleAvatarSelect(avatar)}
              className={`w-20 h-20 rounded-2xl border-2 overflow-hidden transition-all shadow-neo-sm hover:-translate-y-1 hover:shadow-neo ${selectedAvatar === avatar
                ? 'border-primary scale-110 shadow-neo-active translate-y-0.5'
                : 'border-black hover:border-primary'
                }`}
            >
              <img src={avatar} alt={`Avatar ${index + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>

        {/* Back Button */}
        <Button
          variant="ghost"
          onClick={() => setStep('email')}
          className="mt-6 text-sm text-gray-500"
        >
          返回上一步
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF9F0] flex flex-col items-center justify-center px-6 py-8 safe-top safe-bottom">
      {/* Logo */}
      <div className="mb-12 text-center">
        <div className="w-24 h-24 mx-auto mb-6 bg-white rounded-2xl border-2 border-black flex items-center justify-center shadow-neo">
          <User className="w-14 h-14 text-black" />
        </div>
        <h1 className="text-3xl font-black text-black tracking-tight">玩家登录</h1>
        <p className="text-sm text-gray-500 mt-3">请输入邮箱并完成验证码验证</p>
      </div>

      {/* Form */}
      <form onSubmit={handleEmailSubmit} className="w-full max-w-sm space-y-5">
        {/* Email Input */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">
            邮箱 <span className="text-gray-400 font-normal">// EMAIL</span>
          </label>
          <div className="relative">
            <Mail className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
              placeholder="name@example.com"
              className="pl-10"
              autoComplete="email"
            />
          </div>
        </div>

        {/* Code Input */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">
            验证码 <span className="text-gray-400 font-normal">// CODE</span>
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="------"
              className="text-center tracking-[0.5em] font-bold"
              maxLength={6}
            />
            <Button
              type="button"
              onClick={handleGetCode}
              disabled={countdown > 0 || !email || isSending}
              className="w-[120px]"
            >
              {countdown > 0 ? `${countdown}s` : isSending ? '发送中' : '获取验证码'}
            </Button>
          </div>
          {hintMessage && (
            <p className="mt-2 text-sm text-[#4169E1] font-medium">{hintMessage}</p>
          )}
          {devCode && (
            <p className="mt-2 text-sm text-[#4169E1] font-medium">
              开发模式验证码：{devCode}
            </p>
          )}
          {errorMessage && (
            <p className="mt-2 text-sm text-red-500 font-medium">{errorMessage}</p>
          )}
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={!email || code.length !== 6 || isVerifying}
          size="lg"
          className="w-full h-14 mt-4 text-lg gap-2"
        >
          {isVerifying ? '验证中' : '下一步'}
          <ArrowRight className="w-5 h-5" />
        </Button>
      </form>

      {/* Footer */}
      <div className="mt-8 text-center space-y-3">
        <p className="text-xs font-medium text-gray-500">登录即表示同意《用户协议》和《隐私政策》</p>
      </div>
    </div>
  );
}
