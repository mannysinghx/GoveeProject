import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AiStatusDto, type PatternDraft } from '@glm/shared';
import { capabilities, device, mockApi, renderApp } from '../../test/fixtures';
import { PatternEditorPage } from '../patterns/PatternEditorPage';
import { applyPatternDraft, canvasCells, cellColor, describeStrings, resolveStrings } from '../patterns/pattern-model';
import { ScheduleEditor } from '../schedules/ScheduleEditor';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const string27 = (id: string, name: string) =>
  device({
    id,
    name,
    capabilities: [capabilities.power, { ...capabilities.segments, segments: Array.from({ length: 27 }, (_, i) => i), maxSelect: 27 }],
  });
const left = string27('left', 'Outdoor Left');
const right = string27('right', 'Outdoor Right');
const strings = resolveStrings([left, right], []);
const cells = canvasCells(strings);

const ready: AiStatusDto = {
  enabled: true,
  reason: null,
  providers: [{ id: 'deepseek', label: 'DeepSeek', model: 'deepseek-flash', available: true, note: null }],
  monthSpentUsd: 0,
  monthlyLimitUsd: 5,
};

describe('applying a pattern draft', () => {
  it('fills the background, then applies each step in order along the whole run', () => {
    const draft: PatternDraft = {
      name: 'Test',
      background: '#ffffff',
      steps: [
        { op: 'repeat', from: 0, to: 5, colors: ['#ff0000', '#00ff00'], run: 2 },
        { op: 'gradient', from: 26, to: 28, startColor: '#000000', endColor: '#0000ff' },
        { op: 'paint', from: 53, to: 53, color: '#123456' },
      ],
    };
    const state = applyPatternDraft(draft, cells);
    const at = (i: number) => cellColor(state, cells[i]!.key);
    expect([at(0), at(1), at(2), at(3), at(4), at(5)]).toEqual(['#ff0000', '#ff0000', '#00ff00', '#00ff00', '#ff0000', '#ff0000']);
    expect(at(6)).toBe('#ffffff');
    // The gradient crosses from the first string into the second.
    expect([at(26), at(27), at(28)]).toEqual(['#000000', '#000080', '#0000ff']);
    expect(at(53)).toBe('#123456');
  });

  it('ignores anything past the end of the canvas', () => {
    const state = applyPatternDraft({ name: 'x', background: '#000000', steps: [{ op: 'paint', from: 60, to: 70, color: '#ff0000' }] }, cells);
    expect(Object.keys(state.cells)).toHaveLength(0);
  });

  it('sends only names and sizes for the strings shown', () => {
    expect(describeStrings(strings)).toEqual([
      { name: 'Outdoor Left', cells: 27, ledsPerCell: 4 },
      { name: 'Outdoor Right', cells: 27, ledsPerCell: 4 },
    ]);
  });
});

describe('Describe in the pattern editor', () => {
  const routes = {
    'GET /devices': { json: { devices: [left, right] } },
    'POST /devices/refresh-due': { json: { devices: [left, right] } },
    'GET /settings': { json: DEFAULT_SETTINGS },
    'PATCH /settings': (body: unknown) => ({ json: { ...DEFAULT_SETTINGS, ...(body as object) } }),
    'GET /presets': { json: { presets: [] } },
    'GET /ai/status': { json: ready },
  };
  const cell = (name: string, segment: number) => screen.getByRole('button', { name: new RegExp(`^${name} segment ${segment},`) });

  it('draws the draft in the editor, names it, and can be undone, without sending anything', async () => {
    const { calls } = mockApi({
      ...routes,
      'POST /ai/draft-pattern': {
        json: {
          draft: { name: 'Gold ends', background: '#ffd7a8', steps: [{ op: 'paint', from: 0, to: 0, color: '#d4a017' }], note: 'Twinkling is not possible, so this is still.' },
          provider: 'deepseek',
          model: 'deepseek-flash',
          costUsd: 0.0002,
        },
      },
    });
    renderApp(
      <Routes>
        <Route path="/patterns/new" element={<PatternEditorPage />} />
      </Routes>,
      { route: '/patterns/new' },
    );
    await userEvent.type(await screen.findByLabelText('Describe a pattern'), 'Twinkling gold ends');
    await userEvent.click(screen.getByRole('button', { name: 'Draft it' }));

    expect(await screen.findByText(/Drafted into the editor/)).toBeInTheDocument();
    expect(screen.getByText('Twinkling is not possible, so this is still.')).toBeInTheDocument();
    expect(cell('Outdoor Left', 0).getAttribute('aria-label')).toContain('#d4a017');
    expect(cell('Outdoor Left', 1).getAttribute('aria-label')).toContain('#ffd7a8');
    expect(screen.getByLabelText('Pattern name')).toHaveValue('Gold ends');

    const sent = calls.find((c) => c.path === '/ai/draft-pattern')!.body as { description: string; strings: unknown[] };
    expect(sent.description).toBe('Twinkling gold ends');
    expect(sent.strings).toEqual([
      { name: 'Outdoor Left', cells: 27, ledsPerCell: 4 },
      { name: 'Outdoor Right', cells: 27, ledsPerCell: 4 },
    ]);
    expect(calls.some((c) => c.path.startsWith('/presets/apply') || c.path.includes('/devices/left/'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(cell('Outdoor Left', 0).getAttribute('aria-label')).not.toContain('#d4a017');
  });

  it('stays hidden when AI is not set up', async () => {
    mockApi({ ...routes, 'GET /ai/status': { json: { ...ready, enabled: false, reason: 'no_providers', providers: [] } } });
    renderApp(
      <Routes>
        <Route path="/patterns/new" element={<PatternEditorPage />} />
      </Routes>,
      { route: '/patterns/new' },
    );
    await screen.findByText('2 light strings found');
    expect(screen.queryByLabelText('Describe a pattern')).not.toBeInTheDocument();
  });
});

describe('Describe in the schedule editor', () => {
  it('fills the form from a draft, and saves nothing until Save', async () => {
    const { calls } = mockApi({
      'GET /settings': { json: { ...DEFAULT_SETTINGS, defaultTimeZone: 'America/Los_Angeles' } },
      'GET /presets': { json: { presets: [{ id: 'p1', name: 'Diwali glow', description: '', actions: [], builtin: null, createdAt: '', updatedAt: '' }] } },
      'GET /devices': { json: { devices: [left] } },
      'GET /groups': { json: { groups: [{ id: 'g1', name: 'Front', deviceIds: ['left'] }] } },
      'GET /ai/status': { json: ready },
      'POST /schedules/preview': { json: { nextRuns: [], datesWithoutSolarEvent: [], warning: null } },
      'POST /ai/draft-schedule': {
        json: {
          draft: {
            name: 'Diwali evening',
            timeZone: 'America/Los_Angeles',
            recurrence: { kind: 'holiday', holiday: 'diwali', time: '17:30' },
            target: { type: 'group', groupId: 'g1' },
            action: { type: 'preset', presetId: 'p1' },
            missedRunPolicy: 'skip',
            note: 'I picked the Front group.',
          },
          provider: 'deepseek',
          model: 'deepseek-flash',
          costUsd: 0.0001,
        },
      },
    });
    renderApp(<ScheduleEditor schedule={null} onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Describe it'), { target: { value: 'Diwali glow on the front at 5:30 on Diwali' } });
    await userEvent.click(screen.getByRole('button', { name: 'Draft it' }));

    expect(await screen.findByText(/The form is filled in below/)).toBeInTheDocument();
    expect(screen.getByText('I picked the Front group.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Diwali evening');
    expect(screen.getByLabelText('Repeat')).toHaveValue('holiday');
    expect(screen.getByLabelText('Holiday')).toHaveValue('diwali');
    expect(screen.getByLabelText('Time')).toHaveValue('17:30');
    expect(screen.getByLabelText('Action')).toHaveValue('preset');
    await waitFor(() => expect(screen.getByLabelText('Preset')).toHaveValue('p1'));
    expect(screen.getByLabelText('Target')).toHaveValue('group:g1');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/schedules')).toBe(false);
  });

  it('is not offered when editing an existing schedule', async () => {
    mockApi({
      'GET /settings': { json: DEFAULT_SETTINGS },
      'GET /presets': { json: { presets: [] } },
      'GET /devices': { json: { devices: [] } },
      'GET /groups': { json: { groups: [] } },
      'GET /ai/status': { json: ready },
      'POST /schedules/preview': { json: { nextRuns: [], datesWithoutSolarEvent: [], warning: null } },
    });
    renderApp(
      <ScheduleEditor
        schedule={{
          id: 's1',
          name: 'Evening',
          enabled: true,
          timeZone: 'UTC',
          recurrence: { kind: 'daily', time: '18:00' },
          target: { type: 'group', groupId: 'g1' },
          targetName: 'Front',
          action: { type: 'power', on: true },
          actionSummary: 'Turn on',
          missedRunPolicy: 'skip',
          nextRun: null,
          problem: null,
          builtinShow: null,
          quiet: false,
          lastExecution: null,
          createdAt: '',
          updatedAt: '',
        }}
        onClose={() => {}}
      />,
    );
    await screen.findByLabelText('Name');
    expect(screen.queryByLabelText('Describe it')).not.toBeInTheDocument();
  });
});
