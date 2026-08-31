 


export const MOBILE_BREAKPOINT = 700;

 
export function isMobile() {
  if (typeof window === 'undefined') return false;
  return (
    window.innerWidth <= MOBILE_BREAKPOINT ||
    window.matchMedia('(pointer: coarse)').matches
  );
}
