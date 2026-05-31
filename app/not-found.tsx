import { ErrorScreen } from "@/components/states/ErrorScreen";

export default function NotFound() {
  return (
    <ErrorScreen
      kind="404"
      eyebrow="Error 404 · Page not found"
      title="We couldn't find that page."
      body="The page you're after doesn't exist, has moved, or the link is broken. Your plans are safe — let's get you back on track."
      primary={{ label: "Back to the planner", href: "/plan" }}
      secondary={{ label: "Browse the catalog", href: "/catalog" }}
    />
  );
}
