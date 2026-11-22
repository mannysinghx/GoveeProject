import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitCount, useFitCount } from './use-fit-count';

afterEach(() => vi.unstubAllGlobals());

describe('fitCount', () => {
  it('counts what fits across the width, and never goes outside its limits', () => {
    expect(fitCount(300, 14, 8, 60)).toBe(21);
    expect(fitCount(2000, 14, 8, 60)).toBe(60);
    expect(fitCount(40, 14, 8, 60)).toBe(8);
  });

  it('uses the most when it cannot measure', () => {
    expect(fitCount(0, 14, 8, 60)).toBe(60);
    expect(fitCount(Number.NaN, 14, 8, 60)).toBe(60);
    expect(fitCount(300, 0, 8, 60)).toBe(60);
  });
});

function Row() {
  const [ref, count] = useFitCount<HTMLDivElement>(1, 4, 30);
  return (
    <div ref={ref} data-testid="row">
      {count}
    </div>
  );
}

describe('useFitCount', () => {
  it('shows the most when the browser cannot observe sizes', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { getByTestId } = render(<Row />);
    expect(getByTestId('row')).toHaveTextContent('30');
  });

  it('follows the width of the element as it changes, and stops watching when it goes', () => {
    const callbacks: (() => void)[] = [];
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', FakeObserver);
    let width = 160;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontSize: '16px' } as CSSStyleDeclaration);

    const { getByTestId, unmount } = render(<Row />);
    expect(getByTestId('row')).toHaveTextContent('10');
    width = 320;
    act(() => callbacks.forEach((callback) => callback()));
    expect(getByTestId('row')).toHaveTextContent('20');
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
