import { useRef } from 'react';


// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface BilibiliPlayerProps {
    bvid: string;
    title: string;
    coverUrl?: string;
}

export default function BilibiliPlayer({ bvid, title, coverUrl: _coverUrl }: BilibiliPlayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // B站 iframe 嵌入 URL
    const iframeSrc = `//player.bilibili.com/player.html?bvid=${bvid}&page=1&high_quality=1&danmaku=0`;

    const handleOpenInApp = () => {
        // 尝试唤起 B站 App，如果失败则在当前窗口打开 B站 H5 页面
        window.location.href = `https://www.bilibili.com/video/${bvid}`;
    };

    return (
        <div className="flex flex-col gap-2">
            <div
                ref={containerRef}
                className="relative aspect-video bg-black rounded-xl overflow-hidden border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
            >
                <iframe
                    ref={iframeRef}
                    src={iframeSrc}
                    className="w-full h-full"
                    scrolling="no"
                    frameBorder="0"
                    allowFullScreen
                    // 彻底放开所有沙箱限制，允许弹窗、顶层导航、展示等
                    sandbox="allow-top-navigation allow-same-origin allow-forms allow-scripts allow-popups allow-presentation"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                    title={`${title} 教学视频`}
                />
            </div>
            <button
                onClick={handleOpenInApp}
                className="w-full py-2.5 bg-[#FF6699] hover:bg-[#ff85ae] text-white rounded-xl border-2 border-black font-bold text-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none transition-all flex items-center justify-center gap-2"
            >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.124.947.373.284.249.426.551.426.907s-.142.658-.426.906l-1.174 1.147zm-12.48 2.667c-.996 0-1.84.346-2.533 1.04-.694.693-1.04 1.537-1.04 2.533v7.36c0 .995.346 1.84 1.04 2.533.693.693 1.537 1.04 2.533 1.04h13.334c.995 0 1.84-.347 2.533-1.04.693-.694 1.04-1.538 1.04-2.533v-7.36c0-.996-.347-1.84-1.04-2.534-.693-.693-1.538-1.04-2.533-1.04H5.333zm4.267 4.213c.427 0 .8.151 1.12.454.32.302.48.684.48 1.146v2.134c0 .462-.16.844-.48 1.146-.32.303-.693.454-1.12.454s-.8-.151-1.12-.454c-.32-.302-.48-.684-.48-1.146v-2.134c0-.462.16-.844.48-1.146.32-.303.693-.454 1.12-.454zm8.8 0c.426 0 .8.151 1.12.454.32.302.48.684.48 1.146v2.134c0 .462-.16.844-.48 1.146-.32.303-.693.454-1.12.454s-.8-.151-1.12-.454c-.32-.302-.48-.684-.48-1.146v-2.134c0-.462.16-.844.48-1.146.32-.303.693-.454 1.12-.454z" />
                </svg>
                前往 B站 沉浸观看
            </button>
        </div>
    );
}
