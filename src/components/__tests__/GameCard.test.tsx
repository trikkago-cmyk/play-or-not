import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import GameCard from '../GameCard';
import { GAME_DATABASE } from '../../data/gameDatabase';

describe('GameCard Component', () => {
    const mockGame = GAME_DATABASE[0]; // Example: Avalon

    it('renders all required game info and the correct button styles', () => {
        const onPlayThisMock = vi.fn();
        const onChangeMock = vi.fn();

        render(
            <GameCard
                game={mockGame}
                onPlayThis={onPlayThisMock}
                onChange={onChangeMock}
            />
        );

        // Title should be visible
        expect(screen.getByText(mockGame.titleCn)).toBeInTheDocument();

        // Interactions
        const primaryButton = screen.getByText('就玩这个');
        const secondaryButton = screen.getByText('换一个');

        expect(primaryButton).toBeInTheDocument();
        expect(secondaryButton).toBeInTheDocument();

        // Secondary button should now have border-black and boxShadow per the fix
        expect(secondaryButton).toHaveClass('border-black');
        expect(secondaryButton.getAttribute('style')).toContain('box-shadow: 2px 2px 0 0 black');

        // Clicks should register
        fireEvent.click(primaryButton);
        expect(onPlayThisMock).toHaveBeenCalledTimes(1);

        fireEvent.click(secondaryButton);
        expect(onChangeMock).toHaveBeenCalledTimes(1);
    });
});
