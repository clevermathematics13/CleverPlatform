'use client';

import { useState, useEffect, useCallback } from 'react';
import ClassPicker from '@/components/seating/ClassPicker';
import SeatingChart from '@/components/seating/SeatingChart';
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
import type { Student, Seat, Rule, Assignment, Setting, RuleFeedback } from '@/lib/seating-types';

type Tab = 'chart' | 'rules' | 'students' | 'history' | 'heatmap' | 'layout';

export default function SeatingApp() {
  const [classGroup, setClassGroup] = useState('27AH');
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

  const handleGenerate = async () => {
    if (!classGroup) { alert('Pick a class group first.'); return; }
    const latest = await getRules();
    setRules(latest);
    setGenerating(true);
    try {
      const result = generateSeating(students, seats, latest, allAssignments, settings, classGroup);
      await Promise.all([saveCurrentSeating(result), appendAssignments(result)]);
      setCurrentSeating(result);
      setAllAssignments((prev) => [...prev, ...result]);
      setFeedback(evaluateRules(latest, result, classGroup));
    } catch (e) {
      alert('Generation failed: ' + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const filteredSeating = currentSeating.filter((a) => a.class_group === classGroup);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'chart', label: 'Seating' },
    { key: 'rules', label: 'Rules' },
    { key: 'students', label: 'Students' },
    { key: 'history', label: 'History' },
    { key: 'heatmap', label: 'Heatmap' },
    { key: 'layout', label: 'Layout' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Seating Chart</h1>
        <p className="text-sm text-gray-600 mt-1">Generate and manage class seating arrangements.</p>
      </div>

      <div className="space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-300 bg-white p-4 shadow-sm">
          <ClassPicker selected={classGroup} onChange={setClassGroup} />
          <button
            onClick={handleGenerate}
            disabled={!classGroup || generating}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? 'Generating…' : '🎲 Generate Seating'}
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="rounded-lg border border-gray-400 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-300">
          <nav className="flex gap-0 -mb-px">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="rounded-xl border border-gray-300 bg-white p-6 shadow-sm">
          {loading && <p className="text-center text-gray-500 py-12">Loading data…</p>}

          {!loading && tab === 'chart' && (
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
            <StudentList students={students} classGroup={classGroup} />
          )}
          {!loading && tab === 'history' && (
            <History assignments={allAssignments} classGroup={classGroup} />
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
