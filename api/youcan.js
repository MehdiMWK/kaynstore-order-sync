import crypto from "node:crypto";

function secureEqual(left, right) {
  const a = Buffer.from(left || "", "utf8");
  const b = Buffer.from(right || "", "utf8");

  return (
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}

async function readRawBody(request) {
  if (Buffer.isBuffer(request.body)) {
    return request.body;
  }

  if (typeof request.body === "string") {
    return Buffer.from(request.body, "utf8");
  }

  const chunks = [];

  for await (const chunk of request) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}

function normalizeOrderRef(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const raw = String(value)
    .trim()
    .replace(/^#/, "");

  if (/^\d+$/.test(raw)) {
    return `#${raw.padStart(3, "0")}`;
  }

  return `#${raw}`;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return null;
}

function firstObject(values) {
  return values
    .flatMap(value =>
      Array.isArray(value) ? value : [value]
    )
    .find(
      value =>
        value &&
        typeof value === "object"
    ) ?? {};
}

function extractExtraFields(extraFields) {
  if (!extraFields) {
    return {};
  }

  if (
    typeof extraFields === "object" &&
    !Array.isArray(extraFields)
  ) {
    return extraFields;
  }

  if (Array.isArray(extraFields)) {
    const result = {};

    for (const field of extraFields) {
      if (!field || typeof field !== "object") {
        continue;
      }

      const key =
        field.name ??
        field.key ??
        field.label ??
        field.slug;

      const value =
        field.value ??
        field.answer ??
        field.content;

      if (key && value !== undefined) {
        result[String(key)] = value;
      }
    }

    return result;
  }

  return {};
}

function getExtraValue(extra, names) {
  const normalized = {};

  Object.keys(extra || {}).forEach(key => {
    normalized[
      String(key)
        .toLowerCase()
        .replace(/[\s_-]+/g, "")
    ] = extra[key];
  });

  for (const name of names) {
    const key = name
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

    if (
      normalized[key] !== undefined &&
      normalized[key] !== null &&
      String(normalized[key]).trim() !== ""
    ) {
      return normalized[key];
    }
  }

  return null;
}

function normalizeOrder(event) {
  const order = event.data ?? {};
  const customer = order.customer ?? {};

  const shipping = firstObject([
    order.shipping_address,
    order.shipping?.address,
    order.shipping,
    order.address,
    order.delivery_address,
    order.payment_address,
    customer.shipping_address,
    customer.address,
    customer.addresses
  ]);

  const extra = extractExtraFields(
    order.extra_fields ??
    order.extraFields ??
    customer.extra_fields ??
    customer.extraFields
  );

  const firstAddressLine = firstNonEmpty(
    shipping.first_line,
    shipping.firstLine,
    shipping.address_line_1,
    shipping.addressLine1,
    shipping.address1,
    shipping.line1,
    shipping.street,
    shipping.street_address,
    shipping.streetAddress,
    shipping.address,
    shipping.full_address,
    shipping.fullAddress,

    order.address_line_1,
    order.addressLine1,
    order.address1,
    order.street,
    order.full_address,
    order.fullAddress,

    getExtraValue(extra, [
      "address",
      "adresse",
      "full address",
      "full_address",
      "address line 1",
      "address_line_1",
      "street",
      "quartier"
    ])
  );

  const secondAddressLine = firstNonEmpty(
    shipping.second_line,
    shipping.secondLine,
    shipping.address_line_2,
    shipping.addressLine2,
    shipping.address2,
    shipping.line2,

    order.address_line_2,
    order.addressLine2,
    order.address2,

    getExtraValue(extra, [
      "address line 2",
      "address_line_2",
      "complement",
      "complément",
      "building",
      "apartment"
    ])
  );

  const address = [
    firstAddressLine,
    secondAddressLine
  ]
    .filter(Boolean)
    .map(value => String(value).trim())
    .filter(Boolean)
    .join(", ") || null;

  const phone = firstNonEmpty(
    customer.phone,
    customer.phone_number,
    customer.phoneNumber,
    shipping.phone,
    order.phone,
    getExtraValue(extra, [
      "phone",
      "telephone",
      "téléphone",
      "numero",
      "number"
    ])
  );

  const city = firstNonEmpty(
    shipping.city,
    shipping.city_name,
    shipping.cityName,
    order.city,
    customer.city,
    getExtraValue(extra, [
      "city",
      "ville"
    ])
  );

  const items =
    order.items ??
    order.line_items ??
    [];

  return {
    event_name:
      event.event_name,

    event_happened_at:
      event.event_happened_at,

    order_id:
      order.id,

    order_ref:
      normalizeOrderRef(order.ref),

    created_at:
      order.created_at ??
      event.event_happened_at,

    updated_at:
      order.updated_at ??
      event.event_happened_at,

    customer_name:
      [customer.first_name, customer.last_name]
        .filter(Boolean)
        .join(" ") ||
      customer.name ||
      order.customer_name ||
      null,

    phone:
      phone
        ? String(phone).trim()
        : null,

    city:
      city
        ? String(city).trim()
        : null,

    address,

    notes:
      order.notes ??
      order.note ??
      null,

    total_mad:
      firstNonEmpty(
        order.total,
        order.total_price,
        order.totalPrice
      ),

    currency:
      order.currency ??
      "MAD",

    confirmation_status:
      order.confirmation_status ??
      null,

    shipping_status:
      order.shipping_status ??
      null,

    items: items.map(item => ({
      name:
        item.name ??
        item.title ??
        item.product_name ??
        null,

      quantity:
        Number(
          item.quantity ?? 1
        ),

      price:
        item.price ??
        null
    }))
  };
}

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(
  request,
  response
) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");

    return response.status(405).json({
      error: "method_not_allowed"
    });
  }

  const clientSecret =
    process.env.YOUCAN_CLIENT_SECRET;

  const sheetWebhookUrl =
    process.env.SHEET_WEBHOOK_URL;

  const sheetWebhookSecret =
    process.env.SHEET_WEBHOOK_SECRET;

  if (
    !clientSecret ||
    !sheetWebhookUrl ||
    !sheetWebhookSecret
  ) {
    return response.status(503).json({
      error: "service_not_configured"
    });
  }

  const rawBody =
    await readRawBody(request);

  const receivedSignature =
    request.headers[
      "x-youcan-signature"
    ];

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        clientSecret
      )
      .update(rawBody)
      .digest("hex");

  if (
    !secureEqual(
      receivedSignature,
      expectedSignature
    )
  ) {
    return response.status(401).json({
      error: "invalid_signature"
    });
  }

  let event;

  try {
    event = JSON.parse(
      rawBody.toString("utf8")
    );
  } catch {
    console.error(
  "YOUCAN_ADDRESS_DEBUG",
  JSON.stringify({
    event_name: event?.event_name,

    order_keys:
      Object.keys(event?.data || {}),

    customer:
      event?.data?.customer || null,

    shipping:
      event?.data?.shipping || null,

    shipping_address:
      event?.data?.shipping_address || null,

    delivery_address:
      event?.data?.delivery_address || null,

    payment_address:
      event?.data?.payment_address || null,

    address:
      event?.data?.address || null,

    extra_fields:
      event?.data?.extra_fields || null
  })
);
    return response.status(400).json({
      error: "invalid_json"
    });
  }

  if (
    ![
      "order.created",
      "order.updated"
    ].includes(event.event_name)
  ) {
    return response.status(202).json({
      ignored: true
    });
  }

  const normalizedOrder =
    normalizeOrder(event);

  if (!normalizedOrder.order_ref) {
    return response.status(400).json({
      error: "missing_order_ref"
    });
  }

  const deliveryId =
    request.headers[
      "x-youcan-delivery-id"
    ] || null;

  try {
    const upstream =
      await fetch(
        sheetWebhookUrl,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body: JSON.stringify({
            bridge_secret:
              sheetWebhookSecret,

            delivery_id:
              deliveryId,

            order:
              normalizedOrder
          })
        }
      );

    const responseText =
      await upstream.text();

    if (!upstream.ok) {
      console.error(
        "Sheet bridge failed",
        upstream.status,
        responseText
      );

      return response
        .status(502)
        .json({
          error:
            "sheet_bridge_failed",
          upstream_status:
            upstream.status,
          upstream_body:
            responseText
        });
    }

    let sheetResult = null;

    try {
      sheetResult =
        JSON.parse(responseText);
    } catch {
      sheetResult =
        responseText;
    }

    return response.status(200).json({
      accepted: true,
      order_ref:
        normalizedOrder.order_ref,
      phone:
        normalizedOrder.phone,
      city:
        normalizedOrder.city,
      address:
        normalizedOrder.address,
      sheet:
        sheetResult
    });

  } catch (error) {
    console.error(
      "Sheet bridge request failed",
      error
    );

    return response.status(502).json({
      error:
        "sheet_bridge_unreachable"
    });
  }
}
