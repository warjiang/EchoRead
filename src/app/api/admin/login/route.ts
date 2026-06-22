import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Admin login moved to /login with ADMIN_EMAILS authorization." },
    { status: 410 }
  );
}
