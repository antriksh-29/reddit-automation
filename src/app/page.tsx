import { redirect } from "next/navigation";

export default function Home() {
  // No landing page for MVP — redirect to dashboard (middleware handles auth)
  redirect("/dashboard");
}
