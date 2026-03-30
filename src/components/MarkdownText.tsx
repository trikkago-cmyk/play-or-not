import React from 'react';

// Advanced inline parser for Markdown-like features
// Supports: **Bold** (Blue), __Underline__, *Italic*, `Code`, ==Highlight== (Yellow), [Link](Url)
const parseInline = (text: string): React.ReactNode[] => {
    // Regex captures the delimiters to allow splitting while keeping the token type context
    // 1. **Bold**
    // 2. __Underline__
    // 3. ==Highlight==
    // 4. `Code`
    // 5. *Italic*
    // 6. [Link](Url)
    const regex = /(\*\*.*?\*\*|__.*?__|\*.*?\*|`.*?`|==.*?==|\[.*?\]\(.*?\)|\[证据\d+\])/g;
    const parts = text.split(regex);

    return parts.map((part, index) => {
        if (/^\[证据\d+\]$/.test(part)) {
            return (
                <span
                    key={index}
                    className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 mx-0.5 align-middle"
                >
                    {part.slice(1, -1)}
                </span>
            );
        }

        // **Bold** -> Strong (Primary Color)
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
            return (
                <strong key={index} className="font-bold text-blue-700">
                    {part.slice(2, -2)}
                </strong>
            );
        }

        // __Underline__ -> u (Styled)
        if (part.startsWith('__') && part.endsWith('__') && part.length >= 4) {
            return (
                <u key={index} className="underline decoration-wavy decoration-blue-400 underline-offset-4">
                    {part.slice(2, -2)}
                </u>
            );
        }

        // ==Highlight== -> Mark
        if (part.startsWith('==') && part.endsWith('==') && part.length >= 4) {
            return (
                <mark key={index} className="bg-yellow-200 text-orange-900 rounded px-1 font-medium mx-0.5">
                    {part.slice(2, -2)}
                </mark>
            );
        }

        // `Code` -> Inline Code
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
            return (
                <code key={index} className="bg-gray-100 text-pink-600 font-mono text-sm px-1.5 py-0.5 rounded border border-gray-200 mx-0.5">
                    {part.slice(1, -1)}
                </code>
            );
        }

        // *Italic* -> Em
        if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
            return (
                <em key={index} className="italic text-gray-600">
                    {part.slice(1, -1)}
                </em>
            );
        }

        // [Link](Url) -> a
        const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
        if (linkMatch) {
            return (
                <a
                    key={index}
                    href={linkMatch[2]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 underline decoration-blue-300 hover:decoration-blue-800 transition-all font-medium"
                >
                    {linkMatch[1]}
                </a>
            );
        }

        // Normal Text
        return <span key={index}>{part}</span>;
    });
};

interface MarkdownTextProps {
    content: string;
    className?: string;
}

/**
 * A robust, rich-text Markdown renderer.
 * Supports Block styles (Headers, Lists, Quotes, Code Blocks) and Inline styles.
 */
export const MarkdownText: React.FC<MarkdownTextProps> = ({ content, className = '' }) => {
    if (!content) return null;

    const lines = content.split(/\r?\n/);
    let inCodeBlock = false;

    return (
        <div className={`text-sm leading-relaxed space-y-1.5 text-gray-800 ${className}`}>
            {lines.map((line, i) => {
                const trimmed = line.trim();

                // 1. Code Block Toggle
                if (trimmed.startsWith('```')) {
                    inCodeBlock = !inCodeBlock;
                    // If starting block, maybe show language hint? Ignored for simplicity
                    return null;
                }

                // 2. Content inside Code Block
                if (inCodeBlock) {
                    return (
                        <div key={i} className="font-mono text-xs bg-gray-800 text-gray-200 px-3 py-0.5 first:rounded-t last:rounded-b border-l-2 border-blue-500">
                            {line || '\u00A0'}
                        </div>
                    );
                }

                // 3. Empty line -> Spacer
                if (!trimmed) return <div key={i} className="h-2" />;

                // 4. Headers (#)
                if (line.startsWith('# ')) {
                    return <h3 key={i} className="text-lg font-black text-black mt-4 mb-2">{parseInline(line.slice(2))}</h3>;
                }
                if (line.startsWith('## ')) {
                    return <h4 key={i} className="text-base font-bold text-gray-900 mt-3 mb-1">{parseInline(line.slice(3))}</h4>;
                }
                if (line.startsWith('### ')) {
                    return <h5 key={i} className="text-sm font-bold text-gray-700 mt-2">{parseInline(line.slice(4))}</h5>;
                }

                // 5. List items (*, -)
                const listMatch = line.match(/^\s*[-*]\s+(.*)/);
                if (listMatch) {
                    return (
                        <div key={i} className="flex gap-2 ml-1 items-start">
                            <span className="text-blue-500 font-bold mt-0.5 flex-shrink-0">•</span>
                            <span className="flex-1">{parseInline(listMatch[1])}</span>
                        </div>
                    );
                }

                // 6. Numbered List (1.)
                const numMatch = line.match(/^\s*(\d+)\.\s+(.*)/);
                if (numMatch) {
                    return (
                        <div key={i} className="flex gap-2 ml-1 items-start">
                            <span className="text-blue-500 font-bold font-mono text-xs mt-1 flex-shrink-0">{numMatch[1]}.</span>
                            <span className="flex-1">{parseInline(numMatch[2])}</span>
                        </div>
                    );
                }

                // 7. Blockquote (>)
                if (trimmed.startsWith('> ')) {
                    return (
                        <div key={i} className="border-l-4 border-yellow-400 bg-yellow-50 pl-3 py-2 my-2 text-gray-600 italic rounded-r text-xs">
                            {parseInline(trimmed.slice(2))}
                        </div>
                    );
                }

                // 8. Normal Paragraph
                return <div key={i} className="min-h-[1.5em]">{parseInline(line)}</div>;
            })}
        </div>
    );
};
