"use client";
import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PdfUpload } from "@/lib/reflection-types";
interface UploadSectionProps { studentId: string; testId: string; existingUpload: PdfUpload | null; disagreement: number | null; onChangeUpload?: (upload: PdfUpload | null) => void; }
export function UploadSection({ studentId, testId, existingUpload, disagreement, onChangeUpload }: UploadSectionProps) {
  const [upload, setUpload] = useState<PdfUpload | null>(existingUpload);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const isLocked = disagreement === null || disagreement > 0;
  if (isLocked && !upload) {
    return (
      <div className="rounded-lg border-2 border-orange-700/50 bg-orange-900/15 p-5 space-y-3">
        <p className="font-bold text-orange-300">🔒 Upload Locked — Judgement Disagreement Must Reach 0%</p>
        {disagreement !== null && (
          <div className="text-sm text-orange-300/80 space-y-2">
            <p>Current disagreement: <strong>{disagreement.toFixed(1)}%</strong>. The upload form unlocks only when this reaches exactly 0%.</p>
            <p className="font-semibold">Two permitted paths to consensus:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li><strong>Lower your &ldquo;Self&rdquo; mark</strong> for any question where you accept you over-awarded yourself.</li>
              <li><strong>Challenge your teacher&apos;s mark</strong> with your exam paper and the official mark scheme.</li>
            </ol>
          </div>
        )}
      </div>
    );
  }
  if (upload) {
    return (
      <div className="rounded-lg border-2 border-green-700/50 bg-green-900/15 p-5 space-y-3">
        <h3 className="text-lg font-bold text-green-300">🎉 Corrections Uploaded!</h3>
        <p className="text-sm text-green-300/80">File: <strong>{upload.file_name}</strong>{upload.file_size&&<span className="ml-2 text-green-400">({(upload.file_size/1024/1024).toFixed(2)} MB)</span>}</p>
        <button type="button" disabled={removing} onClick={async()=>{
          if(!confirm("Remove this upload and replace it?"))return;
          setRemoving(true); setError(null);
          try {
            const res=await fetch("/api/reflection/upload",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({studentId,testId})});
            if(!res.ok)throw new Error((await res.json()).error);
            setUpload(null); onChangeUpload?.(null);
            if(fileRef.current)fileRef.current.value="";
          } catch(e){setError(e instanceof Error?e.message:"Failed to remove");}
          finally{setRemoving(false);}
        }} className="rounded border border-red-700 bg-da-surface px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/20 disabled:opacity-50">
          {removing?"Removing…":"🗑 Remove & Re-upload"}
        </button>
        {error&&<p className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }
  const handleUpload = async () => {
    const file=fileRef.current?.files?.[0];
    if(!file)return;
    if(file.type!=="application/pdf"){setError("Please select a PDF file.");return;}
    if(file.size>20*1024*1024){setError("File must be under 20 MB.");return;}
    setUploading(true); setError(null); setProgress(0);
    const interval=setInterval(()=>setProgress(p=>p<90?p+5:p),300);
    try {
      const supabase=createClient();
      const storagePath=`${studentId}/${testId}/${file.name}`;
      const{error:uploadError}=await supabase.storage.from("corrections").upload(storagePath,file,{upsert:true});
      if(uploadError)throw uploadError;
      const{data,error:dbError}=await supabase.from("pdf_uploads").upsert({student_id:studentId,test_id:testId,storage_path:storagePath,file_name:file.name,file_size:file.size,uploaded_at:new Date().toISOString()},{onConflict:"student_id,test_id"}).select().single();
      if(dbError)throw dbError;
      const newUpload=data as PdfUpload;
      fetch("/api/reflection/trigger-correction",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({upload_id:newUpload.id,student_id:studentId,test_id:testId})}).catch(()=>{});
      clearInterval(interval); setProgress(100); setUpload(newUpload); onChangeUpload?.(newUpload);
    } catch(e){clearInterval(interval);setProgress(0);setError(e instanceof Error?e.message:"Upload failed");}
    finally{setUploading(false);}
  };
  return (
    <div className="rounded-lg border-2 border-dashed border-da-border bg-da-surface p-5 space-y-4">
      <h3 className="text-lg font-semibold text-da-amber">📤 Step 3: Upload Corrected Work</h3>
      <p className="text-sm text-da-text">Disagreement is <strong>0%</strong> — upload a single PDF of all your corrected exam answers.</p>
      <div className="flex items-center gap-3 flex-wrap">
        <input ref={fileRef} type="file" accept="application/pdf" className="text-sm text-da-muted file:mr-3 file:rounded file:border file:border-da-border file:bg-da-bg file:px-3 file:py-1 file:text-sm file:text-da-accent file:cursor-pointer"/>
        <button type="button" onClick={handleUpload} disabled={uploading} className="rounded-lg bg-da-accent px-4 py-2 text-sm font-bold text-da-bg hover:bg-da-amber disabled:opacity-50">{uploading?"Uploading…":"🚀 Upload"}</button>
      </div>
      {uploading&&(<div className="space-y-1"><div className="h-2.5 w-full rounded-full bg-da-border/40"><div className="h-2.5 rounded-full bg-da-amber transition-all duration-300" style={{width:`${progress}%`}}/></div><p className="text-xs text-da-accent text-center">{progress}%</p></div>)}
      {error&&<p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}