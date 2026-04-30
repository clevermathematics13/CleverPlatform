"use client";

import { useState } from "react";
import { NameCell } from "./NameCell";
import { NicknameCell } from "./NicknameCell";
import {
  setStudentExtraTime,
  setInvitedStudentExtraTime,
  setStudentHidden,
  setInvitedStudentHidden,
  removeStudent,
  removeInvitedStudent,
} from "./actions";
import { startStudentImpersonation } from "../impersonate-actions";

export interface StudentRow {
  key: string;
  type: "enrolled" | "invited";
  name: string | null;
  nickname: string | null;
  email: string | null;
  courseName: string | null;
  profileId: string | null;
  invitedId: string | null;
  studentId: string | null;
  hidden: boolean;
  extraTime: number;
  supportsExtraTime: boolean;
  signedIn: boolean;
}

type SortCol = "name" | "nickname" | "course";
type SortDir = "asc" | "desc";

function firstWord(s: string | null) {
  return (s ?? "").trim().split(/\s+/)[0];
}

function sortRows(rows: StudentRow[], col: SortCol, dir: SortDir): StudentRow[] {
  return [...rows].sort((a, b) => {
    const courseA = (a.courseName ?? "").localeCompare(b.courseName ?? "");
    const nameA = firstWord(a.name).localeCompare(firstWord(b.name));
    const nickA = (a.nickname ?? "").localeCompare(b.nickname ?? "");

    if (col === "course") return (dir === "asc" ? courseA : -courseA) || nameA;
    if (col === "name")   return (dir === "asc" ? nameA  : -nameA)  || courseA;
    /* nickname */        return (dir === "asc" ? nickA  : -nickA)  || courseA || nameA;
  });
}

function SortIcon({ col, active, dir }: { col: SortCol; active: SortCol; dir: SortDir }) {
  if (col !== active) {
    return <span className="ml-1 text-gray-300">↕</span>;
  }
  return <span className="ml-1 text-blue-600">{dir === "asc" ? "↑" : "↓"}</span>;
}

interface Props {
  rows: StudentRow[];
}

export function StudentsTable({ rows }: Props) {
  const [sortCol, setSortCol] = useState<SortCol>("course");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleHeader(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const sorted = sortRows(rows, sortCol, sortDir);

  function thClass(col: SortCol) {
    return (
      "group cursor-pointer select-none px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-blue-700" +
      (col === sortCol ? " text-blue-700" : "")
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className={thClass("name")} onClick={() => handleHeader("name")}>
              Student <SortIcon col="name" active={sortCol} dir={sortDir} />
            </th>
            <th className={thClass("nickname")} onClick={() => handleHeader("nickname")}>
              Nickname <SortIcon col="nickname" active={sortCol} dir={sortDir} />
            </th>
            <th className={thClass("course")} onClick={() => handleHeader("course")}>
              Course <SortIcon col="course" active={sortCol} dir={sortDir} />
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Status
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {sorted.map((row) => (
            <tr key={row.key}>
              {/* Name */}
              <td className="whitespace-nowrap px-6 py-2">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium bg-blue-100 text-blue-700"
                  >
                    {firstWord(row.name)?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div>
                    <NameCell profileId={row.profileId} invitedId={row.invitedId} name={row.name} />
                    {row.hidden && (
                      <span className="ml-1 text-xs font-normal text-gray-400">(hidden)</span>
                    )}
                    <p className="text-xs text-gray-500">{row.email}</p>
                  </div>
                </div>
              </td>

              {/* Nickname */}
              <td className="whitespace-nowrap px-6 py-2">
                <NicknameCell
                  profileId={row.profileId}
                  invitedId={row.invitedId}
                  nickname={row.nickname}
                  fullName={row.name}
                />
              </td>

              {/* Course */}
              <td className="whitespace-nowrap px-6 py-2 text-sm text-gray-700">
                {row.courseName ?? "Unknown"}
              </td>

              {/* Status */}
              <td className="whitespace-nowrap px-6 py-2">
                {row.signedIn ? (
                  <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                    Signed in
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    Not signed in
                  </span>
                )}
              </td>

              {/* Actions */}
              <td className="whitespace-nowrap px-4 py-2 text-right">
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  {row.supportsExtraTime && (
                    <form
                      action={row.type === "enrolled" ? setStudentExtraTime : setInvitedStudentExtraTime}
                      className="flex items-center gap-1"
                    >
                      <input
                        type="hidden"
                        name={row.type === "enrolled" ? "student_id" : "invited_id"}
                        value={(row.type === "enrolled" ? row.studentId : row.invitedId) ?? ""}
                      />
                      <select
                        name="extra_time"
                        defaultValue={row.extraTime}
                        className="rounded border border-blue-300 bg-white px-1 py-0.5 text-xs font-medium text-blue-900"
                      >
                        <option value={0}>No extra time</option>
                        <option value={25}>+25%</option>
                        <option value={50}>+50%</option>
                      </select>
                      <button
                        type="submit"
                        className="rounded border border-blue-200 px-1.5 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        Save
                      </button>
                    </form>
                  )}

                  {row.type === "enrolled" && row.profileId && (
                    <form action={startStudentImpersonation}>
                      <input type="hidden" name="profile_id" value={row.profileId} />
                      <button
                        type="submit"
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        View as student
                      </button>
                    </form>
                  )}

                  <form
                    action={row.type === "enrolled" ? setStudentHidden : setInvitedStudentHidden}
                  >
                    <input
                      type="hidden"
                      name={row.type === "enrolled" ? "student_id" : "invited_id"}
                      value={(row.type === "enrolled" ? row.studentId : row.invitedId) ?? ""}
                    />
                    <input type="hidden" name="hidden" value={row.hidden ? "false" : "true"} />
                    <button
                      type="submit"
                      className="text-xs text-gray-600 hover:text-gray-900"
                    >
                      {row.hidden ? "Unhide" : "Hide"}
                    </button>
                  </form>

                  {row.type === "enrolled" && row.studentId && (
                    <form action={removeStudent}>
                      <input type="hidden" name="student_id" value={row.studentId} />
                      <button type="submit" className="text-xs text-red-600 hover:text-red-800">Remove</button>
                    </form>
                  )}
                  {row.type === "invited" && row.invitedId && (
                    <form action={removeInvitedStudent}>
                      <input type="hidden" name="invited_id" value={row.invitedId} />
                      <button type="submit" className="text-xs text-red-600 hover:text-red-800">Remove</button>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
