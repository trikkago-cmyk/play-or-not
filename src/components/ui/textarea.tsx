import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full rounded-xl border-2 border-black bg-white px-4 py-3 text-base shadow-neo-sm outline-none transition-all placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-black aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-none",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
