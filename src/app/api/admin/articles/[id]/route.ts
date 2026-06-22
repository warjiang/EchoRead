import { NextRequest, NextResponse } from "next/server";
import { adminAuthErrorResponse, authorizeAdminRequest } from "@/lib/admin/auth";
import { deleteAdminArticle, getAdminArticle, updateAdminArticle } from "@/lib/admin/service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  const { id } = await params;
  const article = await getAdminArticle(id);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json(article);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  const { id } = await params;
  return NextResponse.json(await updateAdminArticle(id, await request.json()));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  const { id } = await params;
  const article = await deleteAdminArticle(id);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
