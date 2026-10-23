import type { Testimonial, Office, TimelineEvent, FAQItem } from '../types'

export const testimonials: Testimonial[] = [
  {
    id: 'a0000001-0000-0000-0000-000000000001',
    name: 'fuegocat77 (276)',
    role: '',
    company: '',
    avatar: 'F',
    text: 'Record 91 ½ C Pipe Vise received as pictured on eBay. Shipping was very fast and FREE, with unexpectedly quick delivery from India. Packaging could have been better. Item shipped in corrugated cardboard box completely wrapped in duck tape. Vise itself was heavily covered in bubble wrap. Box was padded with pieces of Styrofoam on the sides and top, but not the bottom. As a result, the front mounting pad wore through the box, resulting in scraped paint. Nothing broken, so not an issue.',
    rating: 5,
    productName: 'RECORD 91 1/2 C PIPE VISE BENCH MOUNT PIPE CLAMP MADE IN E...',
  },
  {
    id: 'a0000002-0000-0000-0000-000000000002',
    name: 'noraedward (1104)',
    role: '',
    company: '',
    avatar: 'N',
    text: 'Very helpful seller. They investigated the issue I had when the delivery company delivered my parcel to the wrong person. Was very quick to address the situation, keep me informed and get the parcel delivered to me. Would recommend.',
    rating: 5,
    productName: 'ROTHENBERGER ROLeak PRO LEAK DETECTOR GAS SNIFFER WITH...',
  },
  {
    id: 'a0000003-0000-0000-0000-000000000003',
    name: 'b2esurplus (7400)',
    role: '',
    company: '',
    avatar: 'B',
    text: 'Five star transaction. Good shipping. Good packaging. Item as described. Good quality product in good condition. Good appearance. Thank you for the good transaction! All five stars. At B2E Surplus (aka Back to Earth Surplus), we buy and sell a lot of similar merchandise. We are always interested in bulk lots and/or good deals on industrial supplies. Look us up anytime!',
    rating: 5,
    productName: 'RIDGID D223 PIPE THREADER RATCHET 1 INCH SQUARE DRIVE FOR...',
  },
  {
    id: 'a0000004-0000-0000-0000-000000000004',
    name: 'nayatolu (37)',
    role: '',
    company: '',
    avatar: 'N',
    text: 'Excelente vendedor, mi compra llegó sin problema alguno.',
    rating: 5,
    productName: 'RIDGID 405/408M TUBING BENDER 5/16 OD 15/16 R & 8 MM OD 2...',
    verified: 'Past 6 months • Verified purchase',
  },
  {
    id: 'a0000005-0000-0000-0000-000000000005',
    name: 'tomas-gsxr (132)',
    role: '',
    company: '',
    avatar: 'T',
    text: 'Absolutt super proffesional we hit a bumb in the road they reaction was lightning fast i will do moore business with these guys',
    rating: 5,
    productName: 'DEUMO KUKKO NO 56-2 HYDRAULIC NUT SPLITTER 700NM 7KPM...',
    verified: 'Past 6 months • Verified purchase',
  },
  {
    id: 'a0000006-0000-0000-0000-000000000006',
    name: '',
    role: '',
    company: '',
    avatar: 'V',
    text: 'EL PEDIDO FUE ENVIADO A TIEMPO, MUY BIEN EMPACADO Y CORRESPONDE CON LO OBSERVADO EN LAS IMAGENES QUE FUERON EXHIBIDAS EN LA PAGINA, VENDEDOR AMPLIAMENTE RECOMENDADO',
    rating: 5,
    productName: 'TITAN CHAIN TONGS JAWS SIZE 16 PART NO C161 REPLACEMENT J...',
  },
]

export const offices: Office[] = [
  {
    city: 'BHAVNAGAR',
    country: 'India',
    address: 'PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA',
    timezone: 'Asia/Kolkata',
    phone: '+91 87990 95041',
    email: 'sales@alkatraders.co',
    coordinates: [21.7645, 72.1519],
  },
]

export const timelineEvents: TimelineEvent[] = [
  { year: '1990', title: 'Founded in Bhavnagar, Gujarat', description: 'Alka Traders began its journey in Bhavnagar, Gujarat as a marine procurement specialist serving the Indian coastal fleet.' },
  { year: '2013', title: '100+ Brand Partnerships', description: 'Crossed 100 authorized brand partnerships across marine and industrial sectors.' },
  { year: '2016', title: '10,000+ Products', description: 'Catalog crossed 10,000 line items across 6 major categories.' },
  { year: '2019', title: 'Global Expansion', description: 'Expanded global reach serving customers in 30+ countries worldwide.' },
  { year: '2022', title: 'Modern Headquarters', description: 'Consolidated operations into a modern headquarters facility in Bhavnagar, Gujarat.' },
  { year: '2024', title: 'Global Operations', description: 'Serving 50+ countries with a network of 200+ brand partners from our Bhavnagar hub.' },
]

export const faqItems: FAQItem[] = [
  {
    question: 'How quickly do you respond?',
    answer: 'Our standard response time is within 4 business hours for all RFQs. For emergency requests marked as Same Day, our dedicated team activates within 30 minutes and maintains contact until delivery is confirmed.',
  },
  {
    question: 'Do you verify product authenticity?',
    // Must match the Terms of Service and the Return & Refund Policy: most
    // stock is used/surplus sold as inspected and without a manufacturer
    // warranty, and certificates accompany an item only when the supplier
    // issues them. The previous answer claimed OEM stock and certificates with
    // every shipment, which the terms deny — see U-14/C-5.
    answer: 'Every listing states the condition grade — new, refurbished, used, or surplus — and the part identity (brand, model, part number or IMPA code) recorded by our team. Most of our stock is used or surplus equipment that we inspect and describe as accurately as possible; these items are sold as inspected and are not covered by a manufacturer warranty, as set out in our Terms of Service. Where the supplier provides a certificate of conformity, test report, or material certificate, it accompanies the item and is listed in the quotation — certificates are not automatic for every shipment. Ask for any document you need before ordering and we will tell you whether it is available.',
  },
  {
    question: 'Can you handle emergency orders?',
    answer: 'Yes. Our emergency procurement line operates 24/7. We maintain strategic inventory for critical-path deliveries from our Bhavnagar hub. We\'ve successfully fulfilled emergency orders within 18 hours of RFQ submission.',
  },
  {
    question: 'What regions do you ship to?',
    answer: 'We operate in 50+ countries across all major maritime routes and industrial corridors. Our primary hubs cover Asia-Pacific, Middle East, Europe, Africa, and the Americas. We handle all customs documentation, export licensing, and freight logistics.',
  },
]
