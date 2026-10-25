import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type LogEntry } from '@/shared/api';

import { mcpEntry, mcpFact } from './log-fixtures';
import { MessageList, type MessageListProps } from './message-list';

const entry = (id: number): LogEntry =>
  mcpEntry(
    mcpFact({
      id,
      jsonrpcId: id,
      raw: `{"jsonrpc":"2.0","id":${id},"method":"tools/list"}`,
    }),
  );

/** Records every observer so tests can report intersections by hand. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly observed: Element[] = [];
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit | undefined,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }

  intersect(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting }] as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
}

const liveObserver = () => {
  const observer = FakeIntersectionObserver.instances.findLast(
    (candidate) => !candidate.disconnected,
  );
  if (observer === undefined) {
    throw new Error('No live IntersectionObserver');
  }
  return observer;
};

describe('MessageList', () => {
  const mockOnLoadOlder = vi.fn<() => void>();
  const mockOnSelect = vi.fn<(id: number) => void>();

  const renderList = (props: Partial<MessageListProps> = {}) =>
    render(
      <MessageList
        layout="full"
        entries={[entry(2), entry(1)]}
        hasOlder
        loadingOlder={false}
        selectedId={null}
        onLoadOlder={mockOnLoadOlder}
        onSelect={mockOnSelect}
        {...props}
      />,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for older entries when the end of the list intersects', () => {
    renderList();

    act(() => {
      liveObserver().intersect(true);
    });

    expect(mockOnLoadOlder).toHaveBeenCalledOnce();
  });

  it('does not ask while the end of the list is out of view', () => {
    renderList();

    act(() => {
      liveObserver().intersect(false);
    });

    expect(mockOnLoadOlder).not.toHaveBeenCalled();
  });

  it('watches the end of the list inside its scroll container', () => {
    const { container } = renderList();

    const { observed, options } = liveObserver();

    expect(observed).toHaveLength(1);
    expect(container.firstElementChild).toContainElement(
      observed[0] as HTMLElement,
    );
    expect(options?.root).toBe(container.firstElementChild);
    expect(options?.rootMargin).toBe('600px');
  });

  it('observes again after more entries load', () => {
    const { rerender } = renderList();
    const first = liveObserver();

    rerender(
      <MessageList
        layout="full"
        entries={[entry(3), entry(2), entry(1)]}
        hasOlder
        loadingOlder={false}
        selectedId={null}
        onLoadOlder={mockOnLoadOlder}
        onSelect={mockOnSelect}
      />,
    );

    expect(first.disconnected).toBe(true);
    expect(liveObserver()).not.toBe(first);
  });

  it('shows that older entries are loading and stops observing', () => {
    renderList({ loadingOlder: true });

    expect(screen.getByText('Loading older entries…')).toBeInTheDocument();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it('shows the start of the log when nothing older is left', () => {
    renderList({ hasOlder: false });

    expect(screen.getByText('Start of log')).toBeInTheDocument();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it('renders one button per entry', () => {
    renderList({ hasOlder: false });

    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  describe('layout', () => {
    const columnHeaders = () =>
      screen
        .getAllByText(/^(Time|Layer|Kind|Name|Status|Summary|Session|Took)$/)
        .map((header) => header.textContent);

    it('shows every column in the full layout', () => {
      renderList({ layout: 'full', hasOlder: false });

      expect(columnHeaders()).toEqual([
        'Time',
        'Layer',
        'Kind',
        'Name',
        'Status',
        'Summary',
        'Session',
        'Took',
      ]);
      expect(screen.getAllByText('mcp')).toHaveLength(2);
      expect(screen.getAllByText('s1')).toHaveLength(2);
      expect(screen.getAllByText('request')).toHaveLength(2);
      expect(screen.getAllByText('pending')).toHaveLength(2);
    });

    it('shows only Time and Name in the compact layout', () => {
      renderList({ layout: 'compact', hasOlder: false });

      expect(columnHeaders()).toEqual(['Time', 'Name']);
      expect(screen.queryByText('s1')).not.toBeInTheDocument();
      expect(screen.queryByText('request')).not.toBeInTheDocument();
    });

    it('has no direction badge in either layout', () => {
      const { unmount } = renderList({ layout: 'full', hasOlder: false });
      expect(screen.queryByTitle('Client → server')).not.toBeInTheDocument();
      unmount();

      renderList({ layout: 'compact', hasOlder: false });
      expect(screen.queryByTitle('Client → server')).not.toBeInTheDocument();
    });
  });

  it('shows the name of each entry', () => {
    renderList({ hasOlder: false });

    expect(screen.getAllByText('tools/list')).toHaveLength(2);
  });
});
