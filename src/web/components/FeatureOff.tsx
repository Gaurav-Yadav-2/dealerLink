import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { buttonClass, Card, EmptyState } from "./ui";

/** Shown in place of a page whose feature the platform admin has switched off for this business. */
export function FeatureOff({ title, back = "/dashboard" }: { title: string; back?: string }) {
  return (
    <Card>
      <EmptyState
        icon={<Lock />}
        title={`${title} isn't enabled for your business`}
        description="Contact DealerLink support if you'd like it switched on."
        action={<Link to={back} className={buttonClass("secondary", "md")}>Back to overview</Link>}
      />
    </Card>
  );
}
