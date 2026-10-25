import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type LogEntry } from '@/shared/api';
import { type ApiError, useCarriedEntries } from '@/ui/api';

import {
  errorFact,
  httpEndFact,
  httpEntry,
  httpFact,
  mcpEntry,
  mcpFact,
  noReplyFact,
  replyFact,
} from './log-fixtures';
import { MessageDetail, type MessageDetailProps } from './message-detail';

vi.mock('@/ui/api');

const mockUseCarriedEntries = vi.mocked(useCarriedEntries);

const carrying = (entries: LogEntry[] | undefined, error?: ApiError) => {
  const result: ReturnType<typeof useCarriedEntries> = {
    data: entries,
    error,
    isLoading: entries === undefined && error === undefined,
    isValidating: false,
    mutate: vi.fn(),
  };
  mockUseCarriedEntries.mockReturnValue(result);
};

const exchange = httpFact({
  id: 100,
  request: {
    method: 'POST',
    url: 'http://127.0.0.1:6280/s/weather/mcp',
    headers: { 'x-request-header': 'from-client' },
    body: { jsonrpc: '2.0', method: 'tools/list' },
    truncated: false,
  },
  response: {
    status: 200,
    headers: { 'x-response-header': 'from-server' },
    stream: false,
    body: { ok: 'plain-body' },
    truncated: false,
  },
});

const stream = httpFact({ id: 200 });

const request = mcpFact({
  id: 300,
  jsonrpcId: 3,
  raw: '{"jsonrpc":"2.0","id":3,"method":"tools/list"}',
  carriedBy: 100,
});
const reply = replyFact(
  request,
  { tools: [] },
  { id: 301, carriedBy: 200, sse: { id: '9', event: 'message' } },
);
const notification = mcpFact({
  id: 302,
  from: 'server',
  kind: 'notification',
  method: 'notifications/tools/list_changed',
  jsonrpcId: null,
  raw: '{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
  carriedBy: 200,
  sse: { id: '10', event: 'message' },
});

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);

describe('MessageDetail', () => {
  const mockOnClose = vi.fn<() => void>();

  const renderDetail = (
    entry: LogEntry,
    props: Partial<MessageDetailProps> = {},
  ) =>
    render(
      <MemoryRouter>
        <MessageDetail
          entry={entry}
          entries={[entry]}
          server="weather"
          onClose={mockOnClose}
          {...props}
        />
      </MemoryRouter>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    carrying([]);
  });

  describe('tabs', () => {
    it('are Overview, Request and Response for an exchange', () => {
      renderDetail(httpEntry(exchange));

      expect(tabNames()).toEqual(['Overview', 'Request', 'Response']);
    });

    it('are Overview, Request and Response for a pair', () => {
      renderDetail(mcpEntry(request, reply));

      expect(tabNames()).toEqual(['Overview', 'Request', 'Response']);
    });

    it('are Overview and Message for an unpaired message', () => {
      renderDetail(mcpEntry(notification));

      expect(tabNames()).toEqual(['Overview', 'Message']);
    });

    it('open the first tab at first, then keep the chosen one across selections', async () => {
      const pair = mcpEntry(request, reply);
      const { rerender } = renderDetail(pair);
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
        'aria-selected',
        'true',
      );

      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));
      rerender(
        <MemoryRouter>
          <MessageDetail
            entry={httpEntry(exchange)}
            entries={[]}
            server="weather"
            onClose={mockOnClose}
          />
        </MemoryRouter>,
      );

      expect(screen.getByRole('tab', { name: 'Response' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('open the tab named by the URL fragment', () => {
      render(
        <MemoryRouter initialEntries={['/servers/weather/logs/100#response']}>
          <MessageDetail
            entry={mcpEntry(request, reply)}
            entries={[]}
            server="weather"
            onClose={mockOnClose}
          />
        </MemoryRouter>,
      );

      expect(screen.getByRole('tab', { name: 'Response' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('treat Message and Request as the same choice', async () => {
      const unpaired = mcpEntry(notification);
      const pair = mcpEntry(request, reply);
      const { rerender } = renderDetail(unpaired);
      await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
      await userEvent.click(screen.getByRole('tab', { name: 'Message' }));

      rerender(
        <MemoryRouter>
          <MessageDetail
            entry={pair}
            entries={[pair]}
            server="weather"
            onClose={mockOnClose}
          />
        </MemoryRouter>,
      );

      expect(screen.getByRole('tab', { name: 'Request' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('fall back to the first tab for an entry without the chosen one', async () => {
      const pair = mcpEntry(request, reply);
      const unpaired = mcpEntry(notification);
      const { rerender } = renderDetail(pair);
      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));

      rerender(
        <MemoryRouter>
          <MessageDetail
            entry={unpaired}
            entries={[unpaired]}
            server="weather"
            onClose={mockOnClose}
          />
        </MemoryRouter>,
      );

      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });

  describe('header', () => {
    it('shows name, type, status and took, and closes', async () => {
      renderDetail(mcpEntry(request, reply));

      expect(
        screen.getByRole('heading', { name: 'tools/list' }),
      ).toBeInTheDocument();
      expect(screen.getByText('request')).toBeInTheDocument();
      expect(screen.getByText('ok')).toBeInTheDocument();
      expect(
        within(
          screen.getByRole('heading', { name: 'tools/list' }).parentElement!,
        ).getByText(/12 ms/),
      ).toBeInTheDocument();

      await userEvent.click(
        screen.getByRole('button', { name: 'Close details' }),
      );
      expect(mockOnClose).toHaveBeenCalledOnce();
    });
  });

  describe('of an exchange', () => {
    it('shows the request line and headers, and links the messages it sent instead of its body', async () => {
      const sent = mcpEntry(request, reply);
      carrying([sent]);
      renderDetail(httpEntry(exchange));
      await userEvent.click(screen.getByRole('tab', { name: 'Request' }));

      expect(
        screen.getByText('POST http://127.0.0.1:6280/s/weather/mcp'),
      ).toBeInTheDocument();
      expect(screen.getByText('x-request-header')).toBeInTheDocument();
      expect(screen.queryByText('Body')).not.toBeInTheDocument();
      expect(
        screen.queryByText(/"method": "tools\/list"/),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('listitem')).toHaveTextContent('Request');
      expect(screen.getByRole('link', { name: 'tools/list' })).toHaveAttribute(
        'href',
        `/servers/weather/logs/${sent.id}#request`,
      );
    });

    it('shows the body of an OAuth exchange request', async () => {
      renderDetail(
        httpEntry(
          httpFact({
            ...exchange,
            endpoint: 'oauth',
            request: { ...exchange.request, body: { grant: 'oauth-body' } },
          }),
        ),
      );
      await userEvent.click(screen.getByRole('tab', { name: 'Request' }));

      expect(screen.getByText(/oauth-body/)).toBeInTheDocument();
    });

    it('does not list messages for an OAuth exchange', async () => {
      renderDetail(httpEntry(httpFact({ ...exchange, endpoint: 'oauth' })));
      await userEvent.click(screen.getByRole('tab', { name: 'Request' }));

      expect(screen.queryByText('Messages sent')).not.toBeInTheDocument();
      expect(mockUseCarriedEntries).toHaveBeenCalledWith(
        'weather',
        null,
        false,
      );
    });

    it('shows the status line and headers of a plain response, and links its messages instead of its body', async () => {
      carrying([mcpEntry(request, reply)]);
      renderDetail(httpEntry(exchange));

      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));

      expect(screen.getByText('HTTP 200')).toBeInTheDocument();
      expect(screen.getByText('x-response-header')).toBeInTheDocument();
      expect(screen.queryByText(/plain-body/)).not.toBeInTheDocument();
      expect(screen.getByText('Messages received')).toBeInTheDocument();
    });

    it('shows the body of an OAuth exchange response', async () => {
      renderDetail(httpEntry(httpFact({ ...exchange, endpoint: 'oauth' })));

      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));

      expect(screen.getByText(/plain-body/)).toBeInTheDocument();
    });

    it('says the client left when there is no response', async () => {
      renderDetail(httpEntry(httpFact({ response: null })));

      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));

      expect(
        screen.getByText('No response: the client left before headers.'),
      ).toBeInTheDocument();
    });

    it('lists the events a stream carried, oldest first, with links', async () => {
      carrying([mcpEntry(notification), mcpEntry(request, reply)]);
      renderDetail(httpEntry(stream));

      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));

      expect(
        screen.getByText('Event stream: 2 events (open)'),
      ).toBeInTheDocument();
      const events = screen.getAllByRole('listitem');
      expect(events).toHaveLength(2);
      expect(events[0]).toHaveTextContent('Reply');
      expect(events[0]).toHaveTextContent('tools/list');
      expect(events[0]).toHaveTextContent('event: message · id: 9');
      expect(events[1]).toHaveTextContent('Notification');
      expect(events[1]).toHaveTextContent('notifications/tools/list_changed');
      expect(events[1]).toHaveTextContent('event: message · id: 10');
      expect(screen.getByRole('link', { name: 'tools/list' })).toHaveAttribute(
        'href',
        `/servers/weather/logs/${request.id}#response`,
      );
    });

    it('uses the event count of an ended stream and drops "(open)"', async () => {
      carrying([]);
      renderDetail(httpEntry(stream, httpEndFact(stream, { events: 4 })));

      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));

      expect(screen.getByText('Event stream: 4 events')).toBeInTheDocument();
    });

    it('polls the carried entries only while a stream is open', async () => {
      renderDetail(httpEntry(stream));
      await userEvent.click(screen.getByRole('tab', { name: 'Request' }));

      expect(mockUseCarriedEntries).toHaveBeenCalledWith('weather', 200, true);
    });

    it('shows URL, state and endpoint in the overview', async () => {
      renderDetail(httpEntry(exchange));

      await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));

      expect(screen.getByText('State').nextElementSibling).toHaveTextContent(
        'complete',
      );
      expect(screen.getByText('Endpoint').nextElementSibling).toHaveTextContent(
        'mcp',
      );
      expect(screen.getByText('URL').nextElementSibling).toHaveTextContent(
        'http://127.0.0.1:6280/s/weather/mcp',
      );
    });
  });

  describe('of an MCP pair', () => {
    it('shows the request and the reply as JSON', async () => {
      renderDetail(mcpEntry(request, reply));

      await userEvent.click(screen.getByRole('tab', { name: 'Request' }));
      expect(screen.getByText(/"method": "tools\/list"/)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));
      expect(screen.getByText(/"tools": \[\]/)).toBeInTheDocument();
    });

    it('waits for a pending reply', async () => {
      renderDetail(mcpEntry(request));

      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));

      expect(screen.getByText('Waiting for the response…')).toBeInTheDocument();
    });

    it('says why there is no response', async () => {
      const { unmount } = renderDetail(
        mcpEntry(request, noReplyFact(request, 'exchange-ended')),
      );
      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));
      expect(
        screen.getByText('No response: the exchange ended.'),
      ).toBeInTheDocument();
      unmount();

      renderDetail(mcpEntry(request, noReplyFact(request, 'session-closed')));
      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));
      expect(
        screen.getByText('No response: the session closed.'),
      ).toBeInTheDocument();
    });

    it('shows an error reply', async () => {
      renderDetail(mcpEntry(request, errorFact(request, -32602, 'bad')));

      await userEvent.click(screen.getByRole('tab', { name: 'Response' }));

      expect(
        screen.getByText(/"code": -32602/, { selector: 'pre' }),
      ).toBeInTheDocument();
    });

    it('links the request and the reply to the exchanges that carried them', async () => {
      const entry = mcpEntry(request, reply);
      renderDetail(entry, {
        entries: [entry, httpEntry(exchange), httpEntry(stream)],
      });

      await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));

      const links = screen.getAllByRole('link', {
        name: /^(POST|GET) \/s\/weather\/mcp$/,
      });
      expect(links.map((link) => link.textContent)).toEqual([
        'POST /s/weather/mcp',
        'GET /s/weather/mcp',
      ]);
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/servers/weather/logs/100#request',
        '/servers/weather/logs/200#response',
      ]);
      expect(screen.getByText('event: message · id: 9')).toBeInTheDocument();
    });

    it('names an exchange that is not loaded by its id', async () => {
      renderDetail(mcpEntry(request, reply));

      await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));

      expect(
        screen.getByRole('link', { name: 'Exchange #100' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Exchange #200' }),
      ).toBeInTheDocument();
    });
  });

  describe('of an unpaired message', () => {
    it('shows the message', async () => {
      renderDetail(mcpEntry(notification));

      await userEvent.click(screen.getByRole('tab', { name: 'Message' }));

      expect(
        screen.getByText(/notifications\/tools\/list_changed/, {
          selector: 'pre',
        }),
      ).toBeInTheDocument();
    });

    it('says when it was not sent', async () => {
      renderDetail(mcpEntry({ ...notification, carriedBy: null, sse: null }));

      await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));

      // Once in the header's status, once beside the message in the overview.
      expect(screen.getAllByText('not sent')).toHaveLength(2);
    });

    it('links to the exchange that carried it', async () => {
      const entry = mcpEntry(notification);
      renderDetail(entry, { entries: [entry, httpEntry(stream)] });

      await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));

      expect(
        screen.getByRole('link', { name: 'GET /s/weather/mcp' }),
      ).toHaveAttribute('href', '/servers/weather/logs/200#response');
    });
  });
});
