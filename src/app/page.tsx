import { redirect } from "next/navigation";

// This app is only the CRM, so the root is not a landing page. The middleware
// will bounce an unauthenticated visitor from /crm on to /login.
export default function RootPage() {
  redirect("/crm");
}
