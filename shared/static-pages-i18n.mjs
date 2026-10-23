/**
 * Localized static-page metadata (Arabic, Spanish).
 *
 * The Arabic and Spanish pages are indexable and prerendered. Their title,
 * description and H1 used to exist only inside the prerender script, while the
 * React app overwrote them with English literals after hydration — so the
 * document title a crawler saw first and the one a browser settled on
 * disagreed.
 *
 * These three fields now live here, next to the English manifest in
 * `shared/static-pages.mjs`, and are imported by the prerenderer and the React
 * SEO layer. The long-form body paragraphs stay in the prerender script: they
 * are build-time content and are not needed in the client bundle.
 *
 * Every slug here must also exist in `STATIC_PAGE_META`.
 */

import { SITE_NAME } from './static-pages.mjs'

export const LOCALIZED_PAGE_META = {
  ar: {
    "": {
      title: "مورد قطع غيار السفن والمعدات البحرية | Alka Traders",
      description:
        "مورد عالمي لقطع غيار السفن والآلات البحرية والمعدات الفائضة والهيدروليكية والنيوماتيكية والأتمتة الكهربائية وقطع المشتريات الطارئة. نخدم المشترين في أكثر من 50 دولة انطلاقا من بافناغور، غوجاراط، الهند.",
      h1: "قطع غيار بحرية ومعدات صناعية",
    },
    "products": {
      title: "كتالوج قطع غيار السفن والمعدات البحرية | Alka Traders",
      description:
        "تصفح قطع غيار السفن والمعدات البحرية وقطع غيار محركات السفن والمضخات الهيدروليكية والأتمتة الكهربائية ومعدات الملاحة ومعدات السلامة ومخزون المعدات الصناعية الفائض.",
      h1: "كتالوج قطع غيار السفن والمعدات البحرية",
    },
    "industries": {
      title: "القطاعات التي نخدمها - الشحن البحري والنفط والغاز وتوليد الكهرباء | Alka Traders",
      description:
        "تخدم Alka Traders قطاعات الشحن البحري والنفط والغاز وتوليد الكهرباء والتصنيع والمعالجة الكيميائية وبناء السفن والتعدين بمعدات متخصصة.",
      h1: "القطاعات التي نخدمها",
    },
    "brands": {
      title: "العلامات التجارية - موردو المعدات البحرية والصناعية | Alka Traders",
      description:
        "استكشف العلامات التجارية التي نتعامل معها - ABB وSiemens وParker Hannifin وBosch Rexroth وDanfoss وHoneywell وغيرها من المصنعين الرائدين.",
      h1: "العلامات التجارية",
    },
    "about": {
      title: "من نحن - متخصصون في المعدات البحرية | Alka Traders",
      description:
        "Alka Traders - مورد معدات بحرية وصناعية متصل بالعالم ومقره بافناغور، غوجاراط، الهند. منذ 1990 - أكثر من 35 عاما من الخبرة في القطاع.",
      h1: "من نحن",
    },
    "rfq": {
      title: "اطلب عرض سعر - طلب أسعار لقطع بحرية وصناعية | Alka Traders",
      description:
        "أرسل طلب عرض سعر لقطع غيار بحرية ومعدات صناعية وآلات فائضة وقطع صعب العثور عليها. رد سريع خلال ساعات.",
      h1: "اطلب عرض سعر",
    },
    "contact": {
      title: "اتصل بنا - Alka Traders",
      description:
        "تواصل مع Alka Traders. مقرنا في بافناغور، غوجاراط، الهند. راسلنا عبر البريد الإلكتروني أو الهاتف أو واتساب أو نموذج الاتصال.",
      h1: "اتصل بنا",
    },
    "emergency": {
      title: "المشتريات الطارئة - دعم قطع بحرية على مدار الساعة | Alka Traders",
      description:
        "مشتريات طارئة لقطع بحرية وصناعية - دعم على مدار الساعة مع سجل تسليم خلال 18 ساعة. أرسل بيانات القطعة عبر واتساب أو الهاتف للحصول على رد فوري.",
      h1: "المشتريات الطارئة",
    },
    "network": {
      title: "الشبكة العالمية - Alka Traders",
      description:
        "تمتد شبكة Alka Traders العالمية عبر أكثر من 18 دولة في آسيا والمحيط الهادئ وأوروبا والشرق الأوسط وأفريقيا والأمريكتين. المقر الرئيسي في بافناغور، غوجاراط، الهند.",
      h1: "الشبكة العالمية",
    },
    "intelligence": {
      title: "رؤى التوريد البحري والصناعي | Alka Traders",
      description:
        "اتجاهات التوريد وبيانات التوفر الإقليمية ومعايير المشتريات الطارئة ورؤى إدارة تقادم القطع للمشترين البحريين والصناعيين.",
      h1: "رؤى التوريد",
    },
    "privacy-policy": {
      title: "سياسة الخصوصية | Alka Traders",
      description:
        "سياسة خصوصية Alka Traders: كيف نجمع ونستخدم ونشارك ونحمي معلوماتك الشخصية، بما في ذلك ملفات تعريف الارتباط والاحتفاظ بالبيانات وحقوقك.",
      h1: "سياسة الخصوصية",
    },
    "terms-of-service": {
      title: "الشروط والأحكام | Alka Traders",
      description:
        "شروط وأحكام Alka Traders: شروط الطلب وسعر الشراء والملكية والتسليم والفحص والضمانات وسياسة الإلغاء وسياسة الشحن.",
      h1: "الشروط والأحكام",
    },
    "refund-policy": {
      title: "سياسة الإرجاع والاسترداد | Alka Traders",
      description:
        "سياسة الإرجاع والاسترداد في Alka Traders: نافذة إرجاع مدتها 30 يوما مع تصريح إرجاع مطلوب. تفاصيل الأهلية والإجراءات والعناصر التالفة ومواعيد الاسترداد.",
      h1: "سياسة الإرجاع والاسترداد",
    },
  },
  es: {
    "": {
      title: "Proveedor de repuestos marítimos y maquinaria naval | Alka Traders",
      description:
        "Proveedor global de repuestos marítimos, maquinaria naval, equipos sobrantes, hidráulica, neumática, automatización eléctrica y piezas de compras de emergencia. Servimos a compradores en más de 50 países desde Bhavnagar, Gujarat, India.",
      h1: "Repuestos marítimos y equipos industriales",
    },
    "products": {
      title: "Catálogo de repuestos marítimos y maquinaria naval | Alka Traders",
      description:
        "Explore repuestos marítimos, piezas navales, repuestos de motores navales, bombas hidráulicas, automatización eléctrica, equipos de navegación, seguridad, aparejos y existencias industriales sobrantes.",
      h1: "Catálogo de repuestos marítimos",
    },
    "industries": {
      title: "Sectores atendidos - Naval, petróleo y gas, generación eléctrica | Alka Traders",
      description:
        "Alka Traders sirve a los sectores de transporte marítimo, petróleo y gas, generación eléctrica, fabricación, procesamiento químico, construcción naval y minería con equipos especializados.",
      h1: "Sectores que atendemos",
    },
    "brands": {
      title: "Marcas - Proveedores de equipos marítimos e industriales | Alka Traders",
      description:
        "Explore las marcas con las que trabajamos: ABB, Siemens, Parker Hannifin, Bosch Rexroth, Danfoss, Honeywell y otros fabricantes líderes.",
      h1: "Marcas",
    },
    "about": {
      title: "Sobre nosotros - Especialistas en equipos marítimos | Alka Traders",
      description:
        "Alka Traders: proveedor global de equipos marítimos e industriales con sede en Bhavnagar, Gujarat, India. Desde 1990, más de 35 años de experiencia en el sector.",
      h1: "Sobre nosotros",
    },
    "rfq": {
      title: "Solicitar presupuesto - RFQ de piezas marítimas e industriales | Alka Traders",
      description:
        "Envíe una solicitud de presupuesto para repuestos marítimos, equipos industriales, maquinaria sobrante y piezas difíciles de encontrar. Respuesta rápida en pocas horas.",
      h1: "Solicitar un presupuesto",
    },
    "contact": {
      title: "Contáctenos - Alka Traders",
      description:
        "Póngase en contacto con Alka Traders. Con sede en Bhavnagar, Gujarat, India. Escríbanos por correo electrónico, teléfono, WhatsApp o mediante el formulario de contacto.",
      h1: "Contáctenos",
    },
    "emergency": {
      title: "Compras de emergencia - Soporte naval 24/7 | Alka Traders",
      description:
        "Compras de emergencia de piezas marítimas e industriales: soporte 24/7 con historial de entrega en 18 horas. Envíe los datos de la pieza por WhatsApp o teléfono para respuesta inmediata.",
      h1: "Compras de emergencia",
    },
    "network": {
      title: "Red global - Alka Traders",
      description:
        "La red global de Alka Traders abarca más de 18 países en Asia-Pacífico, EMEA y América. Oficina central en Bhavnagar, Gujarat, India.",
      h1: "Red global",
    },
    "intelligence": {
      title: "Inteligencia de abastecimiento marino e industrial | Alka Traders",
      description:
        "Tendencias de abastecimiento, datos de disponibilidad regional, referencias de compras de emergencia e ideas de gestión de obsolescencia para compradores marítimos e industriales.",
      h1: "Inteligencia de abastecimiento",
    },
    "privacy-policy": {
      title: "Política de privacidad | Alka Traders",
      description:
        "Política de privacidad de Alka Traders: cómo recopilamos, usamos, compartimos y protegemos su información personal, incluidas las cookies, la retención de datos y sus derechos.",
      h1: "Política de privacidad",
    },
    "terms-of-service": {
      title: "Términos y condiciones | Alka Traders",
      description:
        "Términos y condiciones de Alka Traders: condiciones de pedido, precio de compra, propiedad y entrega, inspección, garantías, cancelación y política de envío.",
      h1: "Términos y condiciones",
    },
    "refund-policy": {
      title: "Política de devoluciones y reembolsos | Alka Traders",
      description:
        "Política de devoluciones y reembolsos de Alka Traders: ventana de 30 días y RMA obligatorio. Detalles de elegibilidad, proceso, artículos dañados y plazos de reembolso.",
      h1: "Política de devoluciones y reembolsos",
    },
  },
}

/**
 * Metadata for one static route in one locale.
 * @param {string} locale
 * @param {string} slug
 * @returns {{ title: string, description: string, h1: string } | null}
 */
export function getLocalizedPageMeta(locale, slug) {
  const table = LOCALIZED_PAGE_META[locale]
  if (!table || !Object.prototype.hasOwnProperty.call(table, slug)) return null
  return table[slug]
}
