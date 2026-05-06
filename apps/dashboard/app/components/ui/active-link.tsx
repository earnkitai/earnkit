// "use client"

// import * as React from "react"
// import Link from "next/link"
// import { usePathname } from "next/navigation"

// import { cn } from "@/lib/utils"
// import { useEffect, useState } from "react"

// export interface ActiveLinkProps
//   extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
//   href: string
// }

// const ActiveLink = React.forwardRef<HTMLAnchorElement, ActiveLinkProps>(
//   ({ className, href, children, ...props }, ref) => {

//     const [isActive, setIsActive] = useState(false);
//     const pathname = usePathname()

//     useEffect(() => {
//       setIsActive(pathname === href)
//     }, [pathname, href])

//     return (
//       <>
//         {isActive ?
//           <Link
//             href={href}
//             className={cn(
//               className,
//               "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary text-primev"
//             )}
//             ref={ref}
//             {...props}
//           >
//             {children}
//           </Link>
//           :
//           <Link
//             href={href}
//             className={cn(
//               className,
//               "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
//             )}
//             ref={ref}
//             {...props}
//           >
//             {children}
//           </Link>
//         }
//       </>
//     )
//   }
// )
// ActiveLink.displayName = "ActiveLink"

// export { ActiveLink }
