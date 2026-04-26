import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveAccessToken } from "@/lib/google-drive";

// Standard Google Slides 16:9 dimensions in EMU
const SLIDE_WIDTH_EMU = 9144000;
const SLIDE_HEIGHT_EMU = 5143500;

interface SlideElement {
  objectId: string;
  shape?: {
    shapeType?: string;
    text?: {
      textElements?: Array<{
        textRun?: { content?: string };
        paragraphMarker?: unknown;
      }>;
    };
  };
  size?: {
    width?: { magnitude?: number };
    height?: { magnitude?: number };
  };
  transform?: {
    translateX?: number;
    translateY?: number;
    scaleX?: number;
    scaleY?: number;
  };
}

function extractText(element: SlideElement): string {
  return (element.shape?.text?.textElements ?? [])
    .map((te) => te.textRun?.content ?? "")
    .join("")
    .trim();
}

function findNameField(
  elements: SlideElement[]
): { x: number; y: number; w: number; h: number } | null {
  for (const el of elements) {
    if (!el.shape) continue;
    const text = extractText(el);
    if (!text.includes("{Name}")) continue;

    const tx = el.transform?.translateX ?? 0;
    const ty = el.transform?.translateY ?? 0;
    const sx = el.transform?.scaleX ?? 1;
    const sy = el.transform?.scaleY ?? 1;
    const ew = (el.size?.width?.magnitude ?? 0) * sx;
    const eh = (el.size?.height?.magnitude ?? 0) * sy;

    return {
      x: tx / SLIDE_WIDTH_EMU,
      y: ty / SLIDE_HEIGHT_EMU,
      w: ew / SLIDE_WIDTH_EMU,
      h: eh / SLIDE_HEIGHT_EMU,
    };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = request.nextUrl;
  const curriculum = url.searchParams.get("curriculum");
  const level = url.searchParams.get("level");
  const paper = parseInt(url.searchParams.get("paper") ?? "0");

  if (!curriculum || !level || !paper) {
    return NextResponse.json(
      { error: "curriculum, level, and paper are required" },
      { status: 400 }
    );
  }

  // Load the template row
  const { data: template, error: tmplError } = await supabase
    .from("exam_templates")
    .select("id, slide_presentation_id, name_field_x, name_field_y, name_field_w, name_field_h")
    .eq("curriculum", curriculum)
    .eq("level", level)
    .eq("paper", paper)
    .single();

  if (tmplError || !template) {
    return NextResponse.json(
      { error: "Template not found for this combination" },
      { status: 404 }
    );
  }

  const accessToken = await getDriveAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Google Drive not connected" },
      { status: 401 }
    );
  }

  const presentationId = template.slide_presentation_id;

  // If we haven't yet discovered the name field coordinates, do it now
  let nameField = template.name_field_x != null
    ? { x: template.name_field_x, y: template.name_field_y!, w: template.name_field_w!, h: template.name_field_h! }
    : null;

  if (!nameField) {
    // Fetch presentation structure to find {Name} element
    const presRes = await fetch(
      `https://slides.googleapis.com/v1/presentations/${presentationId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (presRes.ok) {
      const presData = await presRes.json();
      const firstSlide = presData.slides?.[0];
      if (firstSlide?.pageElements) {
        nameField = findNameField(firstSlide.pageElements as SlideElement[]);
        if (nameField) {
          // Persist discovered coordinates
          await supabase
            .from("exam_templates")
            .update({
              name_field_x: nameField.x,
              name_field_y: nameField.y,
              name_field_w: nameField.w,
              name_field_h: nameField.h,
              updated_at: new Date().toISOString(),
            })
            .eq("id", template.id);
        }
      }
    }
  }

  // Fetch thumbnail for first slide
  const thumbRes = await fetch(
    `https://slides.googleapis.com/v1/presentations/${presentationId}/pages/p/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!thumbRes.ok) {
    const errText = await thumbRes.text();
    return NextResponse.json(
      { error: `Slides API error: ${errText}` },
      { status: 502 }
    );
  }

  const thumbData = await thumbRes.json();
  const thumbnailUrl: string = thumbData.contentUrl;

  return NextResponse.json({ thumbnailUrl, nameField });
}
