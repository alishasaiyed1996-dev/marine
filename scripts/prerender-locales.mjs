#!/usr/bin/env node

/**
 * Localized prerender body copy for the non-English locales.
 *
 * Pages in Arabic and Spanish are prerendered with translated crawlable copy:
 * serving English text on /ar/ and /es/ URLs while telling Google to index
 * them would be duplicate content in the wrong language — worse than the
 * noindex the audit originally found.
 *
 * Only the long-form body paragraphs live here (build-time content). The
 * localized title, description and H1 come from
 * `shared/static-pages-i18n.mjs`, which the React SEO layer also reads, so the
 * prerendered document and the hydrated page cannot disagree about a page's
 * metadata.
 */

import { getLocalizedPageMeta } from '../shared/static-pages-i18n.mjs'

const LOCALE_BODIES = {
  ar: {
    "": [
      "توفر شركة Alka Traders قطع غيار بحرية وآلات ومعدات صناعية ومخزونا فائضا صعب العثور عليه لأصحاب السفن ومديري الأساطيل وأحواض بناء السفن وفرق المشتريات الصناعية. ويغطي الكتالوج قطع غيار غرفة المحركات والمضخات والمكونات الهيدروليكية والنيوماتيكية والأتمتة الكهربائية ومعدات الملاحة وتجهيزات السطح ومعدات السلامة والحبال ومعدات الرفع.",
      "يقع مقر الشركة في بافناغور، غوجاراط، الهند، بالقرب من سوق معدات السفن في ألانغ. يمكن للمشترين البحث في الكتالوج الإلكتروني، أو طلب عرض سعر برقم القطعة أو بصورة لوحة الصنع، أو التواصل مع فريق المشتريات الطارئة للاحتياجات العاجلة.",
    ],
    "products": [
      "يجمع كتالوج Alka Traders قطع الغيار البحرية والصناعية في واجهة بحث واحدة. تصفح حسب الفئة أو العلامة التجارية، وابحث برقم القطعة أو باسم المنتج، وصفِّ حسب الحالة والتوفر والسعر لتضييق قائمة طويلة من الخيارات.",
      "تعرض صفحات المنتجات المنشورة رمز SKU والعلامة التجارية والفئة والحالة والتوفر كما سجلها فريق المشتريات. وإذا لم تكن القطعة مدرجة، أرسل اسم المصنّع أو الموديل أو صورة لوحة الرقم التسلسلي أو رقم IMPA عبر نموذج طلب السعر ليتحقق الفريق من توفرها لدى الموردين.",
    ],
    "industries": [
      "يحتاج الشحن البحري وأحواض بناء السفن إلى وصول سريع إلى قطع غيار غرفة المحركات وآلات السطح والمضخات ومعدات الملاحة وأنظمة السلامة. تدعم Alka Traders مشغلي الأساطيل ومخططي السفن وساحات الإصلاح ومشاريع الرافعات.",
      "وتستخدم فرق النفط والغاز وتوليد الكهرباء والتصنيع والمعالجة الكيميائية والتعدين شبكة المشتريات نفسها للأتمتة والهيدروليك والنيوماتيك والكهرباء والميكانيكا. ويمكن تسعير المتطلبات من رقم القطعة أو الوصف أو صورة لوحة الصنع.",
    ],
    "brands": [
      "تعمل Alka Traders مع شبكة عالمية من المصنعين وقنوات التوريد المعتمدة في مجال المعدات البحرية والصناعية. ويغطي دليل العلامات التجارية الأتمتة ومحواض الدفع ووحدات التحكم المنطقية والهيدروليك والنيوماتيك والمضخات والمحامل وأجهزة القياس ومعدات السلامة ومعدات الرفع.",
      "تعرض كل صفحة علامة تجارية المنتجات المتاحة حاليا عبر Alka Traders. ولا تضاف صفحات العلامات التجارية إلا عندما تحتوي الكتالوج على مخزون منشور حقيقي ومعلومات توريد ذات قيمة فعلية، حتى لا يحال المشترون إلى مجموعات فارغة.",
    ],
    "about": [
      "تزود Alka Traders المعدات البحرية والصناعية منذ عام 1990. ويقع مقر الشركة في بافناغور، غوجاراط، الهند، بالقرب من سوق تفكيك السفن والمعدات البحرية في ألانغ، وتعمل مع موردين ومشترين في مناطق متعددة.",
      "يركز الفريق على الشراء العملي: تحديد القطعة الصحيحة من لوحة الصنع أو الموديل أو رمز IMPA أو الوصف، والتأكد من الحالة والتوفر، وتنسيق التغليف والتصدير والشحن. ولا تنشر بيانات المنتجات إلا عندما تتوفر لدى الفريق معلومات موثقة كافية لوصف القطعة بدقة.",
    ],
    "rfq": [
      "استخدم نموذج طلب عرض السعر عندما لا تكون القطعة مدرجة، أو عندما يكون الموديل غير مؤكد، أو عندما تحتاج إلى الأسعار والتوفر الحالية. أدرج اسم المصنّع والموديل أو رقم القطعة والكمية وميناء الوجهة وأي صور للوحات الصنع أو الأرقام التسلسلية.",
      "يراجع فريق المشتريات كل طلب ويرد بخيارات التوريد التي يمكنه التحقق منها. وللاحتياجات العاجلة أو الطارئة استخدم الهاتف أو واتساب حتى يتم فرز الطلب خارج ساعات العمل المعتادة.",
    ],
    "contact": [
      "تواصل مع Alka Traders عبر البريد الإلكتروني أو الهاتف أو واتساب للاستفسارات عن المنتجات ومتابعة عروض الأسعار وتحديثات الطلبات وأسئلة مستندات التصدير. يقع الفريق في PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA, BHAVNAGAR-364001, GUJARAT, INDIA.",
      "ولالحصول على عرض سعر أسرع، أدرج رقم القطعة وموديل المعدات والكمية وجهة التسليم في رسالتك الأولى. وعلى العملاء الحاليين الإبقاء على رقم الطلب أو طلب السعر في سطر الموضوع ليصل الطلب إلى المكتب المختص.",
    ],
    "emergency": [
      "لا يمكن للسفن والمصانع أن تنتظر دائما دورة مشتريات معتادة. يتولى مكتب المشتريات الطارئة في Alka Traders طلبات القطع البحرية والصناعية العاجلة على مدار الساعة، باستخدام شبكة الموردين وعملية التصدير نفسها المستخدمة في الطلبات العادية.",
      "أرسل رقم القطعة وتفاصيل المعدات وموقع السفينة أو المنشأة وتاريخ التسليم المطلوب عبر الهاتف أو واتساب. وسيؤكد الفريق ما يمكن توريده ونافذة الشحن الواقعية وخيار الشحن الأنسب للموعد التشغيلي.",
    ],
    "network": [
      "تنسق Alka Traders التوريد والتصدير من بافناغور، غوجاراط، الهند، عبر شبكة من المصنعين والموزعين وموردي الفائض وشركاء الخدمات اللوجستية. وتخدم الشبكة قطع الغيار الإنتاجية الحالية وكذلك المعدات المتوقفة أو صعبة العثور عليها.",
      "يتعامل المشتري مع جهة اتصال واحدة للمشتريات بينما يتحقق الفريق من عدة قنوات توريد ويؤكد هوية القطعة وينسق الشحن. أما التغليف والوثائق وخيارات الشحن الخاصة بالوجهة فتدار ضمن عملية عرض السعر.",
    ],
    "intelligence": [
      "يجمع قسم استخبارات السوق ملاحظات عملية للمشترين البحريين والصناعيين: أين تصبح بعض العائلات أصعب في العثور عليها، وكيف تتغير المهل حسب المنطقة، وأي مسارات شراء تعمل بشكل أفضل للمتطلبات المتقادمة أو الطارئة.",
      "استخدم هذه الملاحظات نقطة انطلاق للتخطيط، ثم أكد التوفر والأسعار الحالية مع فريق المشتريات. ولا تزال قوائم الكتالوج وفحوصات الموردين المباشرة المرجع الموثوق لرقم قطعة بعينه.",
    ],
    "privacy-policy": [
      "توضح هذه السياسة المعلومات التي يجمعها Alka Traders عند تصفح المتجر أو إرسال طلب سعر أو إنشاء حساب أو تقديم طلب. وهي تغطي بيانات الاتصال وسجلات الطلبات وعروض الأسعار ومعالجة الدفع والتحليلات وملفات تعريف الارتباط ومزودي الخدمة الذين يديرون المتجر.",
      "كما توضح مدة الاحتفاظ بالمعلومات والخيارات المتاحة لك وكيفية التواصل مع Alka Traders بشأن سؤال أو طلب متعلق بالخصوصية. اقرأ السياسة الكاملة في هذه الصفحة؛ فهي النسخة المعتمدة للموقع.",
    ],
    "terms-of-service": [
      "تحكم هذه الشروط عروض الأسعار والطلبات والدفع والتسليم والفحص والضمان والإلغاء والمرتجعات للمنتجات التي يوفرها Alka Traders. وتنطبق على طلبات المتجر وعلى المتطلبات المؤكدة عبر طلب السعر.",
      "ولأن القطع البحرية والصناعية تختلف في الحالة ومدة التوريد والمصدر، فإن عرض السعر وتأكيد الطلب يحددان الشروط التجارية الخاصة بكل متطلب. اقرأ الشروط الكاملة في هذه الصفحة وتواصل مع الفريق قبل الطلب إذا كان أي شيء غير واضح.",
    ],
    "refund-policy": [
      "توضح سياسة الإرجاع والاسترداد نافذة الإرجاع البالغة 30 يوما واشتراط الحصول على تصريح إرجاع قبل الشحن، والحالة والوثائق المطلوبة لقطعة مؤهلة للإرجاع. كما تغطي القطع التالفة أو الموردة بشكل خاطئ والأدلة اللازمة لفتح مطالبة.",
      "يعتمد توقيت الاسترداد على وسيلة الدفع ونتيجة الفحص. اقرأ السياسة الكاملة في هذه الصفحة قبل إرجاع أي قطعة، وتواصل مع الفريق مع رقم الطلب ليتم تسجيل المرتجع ومتابعته.",
    ],
  },
  es: {
    "": [
      "Alka Traders suministra repuestos marítimos, maquinaria naval, equipos industriales y existencias sobrantes difíciles de encontrar para armadores, gestores de flotas, astilleros y equipos de compras industriales. El catálogo cubre repuestos de cámara de máquinas, bombas, componentes hidráulicos y neumáticos, automatización eléctrica, equipos de navegación, aparejos de cubierta, seguridad, cabo y equipos de elevación.",
      "La empresa está en Bhavnagar, Gujarat, India, cerca del mercado de equipos marítimos de Alang. Los compradores pueden buscar en el catálogo, solicitar un presupuesto con un número de pieza o una foto de la placa de características, o contactar con el equipo de compras de emergencia para requisitos urgentes.",
    ],
    "products": [
      "El catálogo de Alka Traders reúne los repuestos marítimos e industriales en una única tienda con búsqueda. Explore por categoría o marca, busque por número de pieza o nombre de producto y filtre por estado, disponibilidad y precio para acortar una larga lista de candidatos.",
      "Las páginas de producto publicadas muestran el SKU, la marca, la categoría, el estado y la disponibilidad registrados por el equipo de compras. Si una pieza no aparece, envíe el fabricante, el modelo, la foto de la placa de serie o el número IMPA mediante el formulario de presupuesto y el equipo comprobará la disponibilidad con los proveedores.",
    ],
    "industries": [
      "El transporte marítimo y los astilleros necesitan acceso rápido a repuestos de cámara de máquinas, maquinaria de cubierta, bombas, equipos de navegación y sistemas de seguridad. Alka Traders apoya a operadores de flotas, navieras, astilleros de reparación y proyectos de dique con compras y coordinación de exportación.",
      "Los equipos de petróleo y gas, generación eléctrica, fabricación, procesamiento químico y minería usan la misma red de compras para automatización, hidráulica, neumática, electricidad y mecánica. Las necesidades se pueden presupuestar a partir de un número de pieza, una descripción o una foto de la placa de características.",
    ],
    "brands": [
      "Alka Traders trabaja con una red global de fabricantes y canales de suministro autorizados de equipos marítimos e industriales. El directorio de marcas cubre automatización, accionamientos, autómatas, hidráulica, neumática, bombas, rodamientos, instrumentación, equipos de seguridad y equipos de elevación.",
      "Cada página de marca publicada lista los productos disponibles actualmente a través de Alka Traders. Las páginas de marca solo se amplían cuando el catálogo contiene existencias reales publicadas y aportan información de compras sustantiva, para no enviar al comprador a colecciones vacías.",
    ],
    "about": [
      "Alka Traders suministra equipos marítimos e industriales desde 1990. La empresa tiene su sede en Bhavnagar, Gujarat, India, cerca del mercado de desguace naval y equipos marítimos de Alang, y trabaja con proveedores y compradores en varias regiones.",
      "El equipo se centra en una compra práctica: identificar la pieza correcta a partir de una placa de características, un modelo, un código IMPA o una descripción; confirmar el estado y la disponibilidad; y coordinar el embalaje de exportación y la expedición. Los productos solo se publican cuando el equipo dispone de información verificada suficiente para describirlos con precisión.",
    ],
    "rfq": [
      "Utilice el formulario de solicitud de presupuesto cuando una pieza no esté en el catálogo, cuando el modelo exacto sea incierto o cuando necesite precios y disponibilidad actuales. Incluya el fabricante, el modelo o número de pieza, la cantidad, el puerto de destino y las fotos de la placa de características o del número de serie.",
      "El equipo de compras revisa cada solicitud y responde con las opciones de suministro que puede verificar. Para requisitos urgentes o de emergencia, utilice el teléfono o WhatsApp para que la solicitud se tramite fuera del horario habitual.",
    ],
    "contact": [
      "Contacte con Alka Traders por correo electrónico, teléfono o WhatsApp para consultas de producto, seguimiento de presupuestos, novedades de pedidos y dudas sobre documentación de exportación. El equipo está en PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA, BHAVNAGAR-364001, GUJARAT, INDIA.",
      "Para un presupuesto más rápido, incluya el número de pieza, el modelo del equipo, la cantidad y el destino de entrega en el primer mensaje. Los clientes existentes deben mantener la referencia del pedido o de la solicitud en el asunto para que la solicitud llegue al departamento correcto.",
    ],
    "emergency": [
      "Los buques y las plantas no siempre pueden esperar a un ciclo de compras normal. El equipo de emergencia de Alka Traders atiende solicitudes urgentes de piezas marítimas e industriales las 24 horas, usando la misma red de proveedores y el mismo proceso de exportación que los pedidos estándar.",
      "Envíe por teléfono o WhatsApp el número de pieza, los detalles del equipo, la ubicación del buque o de la planta y la fecha de entrega requerida. El equipo confirmará qué puede abastecerse, la ventana realista de expedición y la opción de envío que mejor encaja con el plazo operativo.",
    ],
    "network": [
      "Alka Traders coordina el abastecimiento y la exportación desde Bhavnagar, Gujarat, India, a través de una red de fabricantes, distribuidores, proveedores de excedentes y socios logísticos. La red cubre tanto repuestos de producción actual como equipos discontinuados o difíciles de encontrar.",
      "El comprador trabaja con un único contacto de compras mientras el equipo consulta varios canales de suministro, confirma la identidad de la pieza y organiza la expedición. El embalaje, la documentación y las opciones de flete por destino se gestionan como parte del proceso de presupuesto.",
    ],
    "intelligence": [
      "La sección de inteligencia de mercado reúne observaciones prácticas para compradores marítimos e industriales: dónde se están volviendo más difíciles de encontrar determinadas familias de piezas, cómo cambian los plazos por región y qué vías de compra funcionan mejor para requisitos obsoletos o de emergencia.",
      "Use estas notas como punto de partida para planificar y confirme después la disponibilidad y los precios actuales con el equipo de compras. Los listados del catálogo y las comprobaciones directas con proveedores siguen siendo la fuente autorizada para un número de pieza concreto.",
    ],
    "privacy-policy": [
      "Esta política explica qué información recopila Alka Traders cuando navega por la tienda, envía una solicitud de presupuesto, crea una cuenta o realiza un pedido. Cubre datos de contacto, registros de pedidos y presupuestos, procesamiento de pagos, analítica, cookies y los proveedores de servicios que operan la tienda.",
      "También describe durante cuánto tiempo se conserva la información, las opciones disponibles y cómo contactar con Alka Traders para una pregunta o solicitud de privacidad. Lea la política completa en esta página: es la versión vigente para el sitio público.",
    ],
    "terms-of-service": [
      "Estos términos rigen presupuestos, pedidos, pago, entrega, inspección, garantía, cancelación y devoluciones de los productos suministrados por Alka Traders. Se aplican tanto a los pedidos de la tienda como a los requisitos confirmados mediante el proceso de RFQ.",
      "Dado que las piezas marítimas e industriales varían en estado, plazo de entrega y origen, el presupuesto y la confirmación del pedido definen las condiciones comerciales concretas de cada requisito. Lea los términos completos en esta página y contacte con el equipo antes de pedir si algo no queda claro.",
    ],
    "refund-policy": [
      "La política de devoluciones y reembolsos explica la ventana de devolución de 30 días, la necesidad de una autorización de devolución antes del envío y el estado y la documentación exigidos para una devolución elegible. También cubre los artículos dañados o enviados por error y las pruebas necesarias para abrir una reclamación.",
      "El plazo de reembolso depende del método de pago y del resultado de la inspección. Lea la política completa en esta página antes de devolver un artículo y contacte con el equipo indicando el número de pedido para que la devolución quede registrada y se pueda seguir.",
    ],
  },
}

/**
 * Locale route metadata, keyed by locale then route slug. Titles,
 * descriptions and headings are merged in from the shared manifest.
 * @type {Record<string, Record<string, { title: string, description: string, h1: string, body: string[] }>>}
 */
export const LOCALE_ROUTE_META = Object.fromEntries(
  Object.entries(LOCALE_BODIES).map(([locale, routes]) => [
    locale,
    Object.fromEntries(
      Object.entries(routes).map(([slug, body]) => {
        const meta = getLocalizedPageMeta(locale, slug)
        if (!meta) {
          throw new Error(`Missing localized metadata for ${locale}/${slug || 'home'}`)
        }
        return [slug, { ...meta, body }]
      }),
    ),
  ]),
)
