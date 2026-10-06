# Design provenance

- Screen composition, product fixtures and photo URLs: user attachment `E-commerce AI Shopping Assistant (Community).zip`, `src/app/App.tsx` (home/chat/ranking/detail and My placeholder).
- Native component styling: Figma `cajZ71MOH37gT4ltwQlvbb`, node `36:1701`, retrieved earlier in this conversation. See `theme.ts` and `assets/figma`.
- Icon family: Make's Lucide icons translated to `lucide-react-native`; original Figma SVG icons retain native 16/18/24/28px dimensions.
- Intentional product adaptations: generic greeting without fabricated account identity; real device-local recent views and saved items; explicit demo metadata; existing PASS engine instead of fixed mock chat; source photos remain data-driven and are not replaced.
- My was a placeholder in the attachment. The implemented local history and wishlist use the same card components; no real authentication or order system is represented.
