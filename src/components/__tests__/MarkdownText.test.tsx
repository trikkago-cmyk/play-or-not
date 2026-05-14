import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownText } from '../MarkdownText';

describe('MarkdownText', () => {
  it('parses markdown while showing a streaming cursor', () => {
    render(
      <MarkdownText
        content={'我会先推 **《阿瓦隆》**。\n- **气氛升温**：桌上戏很多。'}
        showCursor
      />,
    );

    expect(screen.getByText('《阿瓦隆》').tagName).toBe('STRONG');
    expect(screen.getByText('气氛升温').tagName).toBe('STRONG');
    expect(screen.getByText('•')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-streaming-cursor')).toBeInTheDocument();
  });
});
