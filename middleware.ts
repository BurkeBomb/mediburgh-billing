import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Track the tactical application routes
  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isOfficeRoute = pathname.startsWith("/office");

  // Pass immediately if we are targeting the root gateway, authentication forms, or public files
  if (!isDashboardRoute && !isOfficeRoute) {
    return NextResponse.next();
  }

  const supabase = createClient();

  // Inspect cookies for active authenticated tokens
  const { data: { session } } = await supabase.auth.getSession();

  // If unauthenticated, bounce back to login gate and cache source path
  if (!session) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    // Read user role directly out of secure profile tables
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (!profile) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    // Strict boundary enforcement engine
    if (isDashboardRoute && profile.role !== "practitioner") {
      // Office worker or admin attempting to touch clinical entry forms -> Route to desk
      return NextResponse.redirect(new URL("/office", request.url));
    }

    if (isOfficeRoute && profile.role === "practitioner") {
      // Practitioner trying to peek at adjudication workflows -> Bounce to theatre dashboard
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  } catch (err) {
    console.error("Middleware authorization boundary breach intercepted:", err);
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

// Don't intercept static assets or Next.js core internal files
export const config = {
  matcher: ["/dashboard/:path*", "/office/:path*"],
};