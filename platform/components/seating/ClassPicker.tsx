'use client';

import { useEffect, useState } from 'react';
import { getClassGroups } from '@/lib/seating-data';

interface Props {
  selected: string;
  onChange: (group: string) => void;
}

export default function ClassPicker({ selected, onChange }: Props) {
  const [groups, setGroups] = useState<string[]>([]);

  useEffect(() => {
    getClassGroups().then(setGroups).catch(console.error);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-semibold text-da-text">Class</label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-da-border px-3 py-1.5 text-sm text-da-text focus:outline-none focus:ring-2 focus:ring-da-accent"
      >
        <option value="">— pick a class —</option>
        {groups.map((g) => (
          <option key={g} value={g}>{g}</option>
        ))}
      </select>
    </div>
  );
}
