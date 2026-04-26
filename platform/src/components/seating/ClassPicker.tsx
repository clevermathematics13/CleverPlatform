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
      <label className="text-sm font-semibold text-gray-800">Class</label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">— pick a class —</option>
        {groups.map((g) => (
          <option key={g} value={g}>{g}</option>
        ))}
      </select>
    </div>
  );
}
