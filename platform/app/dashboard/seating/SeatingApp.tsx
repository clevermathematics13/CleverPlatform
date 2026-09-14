'use client';

import { useState, useEffect, useCallback } from 'react';
import ClassPicker from '@/components/seating/ClassPicker';
import SeatingChart from '@/components/seating/SeatingChart';
import ExamSeatingChart from '@/components/seating/ExamSeatingChart';
import RuleManager from '@/components/seating/RuleManager';
import StudentList from '@/components/seating/StudentList';
import History from '@/components/seating/History';
import SeatManager from '@/components/seating/SeatManager';
import PairHeatmap from '@/components/seating/PairHeatmap';
import SeatingExplainer from '@/components/seating/SeatingExplainer';
import {
  getStudents, getSeats, getRules, getAssignments,
  getCurrentSeating, getSettings,
  saveCurrentSeating, appendAssignments,
} from '@/lib/seating-data';
import { generateSeating, evaluateRules } from '@/lib/seating-engine';
import { generateExamSeating, latestExamRun } from '@/lib/seating-exam';
import type { Student, Seat, Rule, Assignment, Setting, RuleFeedback, SeatingMode } from '@/lib/seating-types';

type Tab = 'chart' | 'rules' | 'students' | 'history' | 'heatmap' | 'layout';

const MODE_STORAGE_KEY = 'sc_seating_mode';

/**
 * Pods, rules and the pair heatmap are all about who sits with whom, which
 * assessment seating deliberately has no opinion about - it sits everyone on
 * their own. Those tabs are hidden there rather than left to quietly do
 * nothing.
 */
const TABS: { key: Tab; label: string; modes: SeatingMode[] }[] = [
  { key: 'chart', label: 'Seating', modes: ['groups', 'assessment'] },
  { key: 'rules', label: 'Rules', modes: ['groups'] },
  { key: 'students', label: 'Students', modes: ['groups', 'assessment'] },
  { key: 'history', label: 'History', modes: ['groups', 'assessment'] },
  { key: 'heatmap', label: 'Heatmap', modes: ['groups'] },
  { key: 'layout', label: 'Layout', modes: ['groups'] },
];

export default function SeatingApp() {
  const [classGroup, setClassGroup] = useState('27AH');
  const [mode, setMode] = useState<SeatingMode>('groups');
  const [tab, setTab] = useState<Tab>('chart');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [students, setStudents] = useState<Student[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const [currentSeating, setCurrentSeating] = useState<Assignment[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [feedback, setFeedback] = useState<RuleFeedback[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [st, se, ru, as_, cs, cfg] = await Promise.all([
        getStudents(), getSeats(), getRules(), getAssignments(),
        getCurrentSeating(), getSettings(),
      ]);
      setStudents(st); setSeats(se); setRules(ru);
      setAllAssignments(as_); setCurrentSeating(cs); setSettings(cfg);
    } catch (e) {
      alert('Failed to load data: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  /* Load on mount – user is already authenticated via Supabase session */
  useEffect(() => {
    loadData();
  }, [loadData]);

  /* Restore the last mode after mount, not during render, so the server and
     the first client render agree. */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_STORAGE_KEY);
      if (saved === 'assessment' || saved === 'groups') setMode(saved);
    } catch { /* ignore */ }
  }, []);

  const tabs = TABS.filter((t) => t.modes.includes(mode));

  const changeMode = (next: SeatingMode) => {
    setMode(next);
    try { localStorage.setItem(MODE_STORAGE_KEY, next); } catch { /* ignore */ }
    if (!TABS.some((t) => t.key === tab && t.modes.includes(next))) setTab('chart');
  };

  const handleGenerate = async () => {
    if (!classGroup) { alert('Pick a class group first.'); return; }
    setGenerating(true);
    try {
      if (mode === 'assessment') {
        // Assessment runs are history only: they never touch seating_current,
        // so generating one does not throw away the class's group seating.
        const { assignments } = generateExamSeating(students, allAssignments, classGroup);
        await appendAssignments(assignments);
        setAllAssignments((prev) => [...prev, ...assignments]);
      } else {
        const latest = await getRules();
        setRules(latest);
        const result = generateSeating(students, seats, latest, allAssignments, settings, classGroup);
        await Promise.all([saveCurrentSeating(result), appendAssignments(result)]);
        setCurrentSeating(result);
        setAllAssignments((prev) => [...prev, ...result]);
        setFeedback(evaluateRules(latest, result, classGroup));
      }
    } catch (e) {
      alert('Generation failed: ' + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const filteredSeating = currentSeating.filter((a) => a.class_group === classGroup);
  const examSeating = latestExamRun(allAssignments, classGroup);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-da-text">Seating Chart</h1>
        <p className="mt-1 text-sm text-da-muted">Generate and manage class seating arrangements.</p>
      </div>

      <div className="space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-da-border bg-da-surface/80 p-4 shadow-sm shadow-black/25">
          <ClassPicker selected={classGroup} onChange={setClassGroup} />

          <div
            role="group"
            aria-label="Seating mode"
            className="inline-flex overflow-hidden rounded-lg border border-da-border"
          >
            {([
              { value: 'groups', label: 'Groups', title: 'Pods around tables, with pair and pod rules' },
              { value: 'assessment', label: 'Assessment', title: 'One student per desk, in rows of three, alternating B/G' },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.title}
                aria-pressed={mode === option.value}
                onClick={() => changeMode(option.value)}
                className={`px-3 py-2 text-sm font-semibold transition-colors ${
                  mode === option.value
                    ? 'bg-da-accent text-da-on-accent'
                    : 'text-da-muted hover:bg-da-hover hover:text-da-text'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={!classGroup || generating}
            className="rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-da-on-accent transition-colors hover:bg-da-amber disabled:opacity-50"
          >
            {generating
              ? 'Generating…'
              : mode === 'assessment' ? '📝 Generate Exam Seating' : '🎲 Generate Seating'}
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="rounded-lg border border-da-border px-3 py-2 text-sm text-da-text transition-colors hover:bg-da-hover disabled:opacity-50"
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-da-border">
          <nav className="flex gap-0 -mb-px">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === key
                    ? 'border-da-accent text-da-accent'
                    : 'border-transparent text-da-muted hover:text-da-text'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="rounded-xl border border-da-border bg-da-surface/80 p-6 shadow-sm shadow-black/25">
          {loading && <p className="py-12 text-center text-da-muted">Loading data…</p>}

          {!loading && tab === 'chart' && mode === 'assessment' && (
            <ExamSeatingChart
              assignments={examSeating}
              students={students}
              classGroup={classGroup}
            />
          )}
          {!loading && tab === 'chart' && mode === 'groups' && (
            <>
              <SeatingChart seats={seats} assignments={filteredSeating} classGroup={classGroup} />
              <SeatingExplainer
                assignments={filteredSeating}
                rules={rules}
                students={students}
                classGroup={classGroup}
              />
            </>
          )}
          {!loading && tab === 'rules' && (
            <RuleManager
              rules={rules} students={students} seats={seats}
              classGroup={classGroup} onSaved={loadData}
              feedback={feedback}
            />
          )}
          {!loading && tab === 'students' && (
            <StudentList students={students} classGroup={classGroup} onGenderSaved={loadData} />
          )}
          {!loading && tab === 'history' && (
            <History assignments={allAssignments} classGroup={classGroup} mode={mode} />
          )}
          {!loading && tab === 'heatmap' && (
            <PairHeatmap
              assignments={allAssignments}
              students={students}
              classGroup={classGroup}
            />
          )}
          {tab === 'layout' && (
            <SeatManager classGroup={classGroup} onSaved={loadData} />
          )}
        </div>
      </div>
    </div>
  );
}
