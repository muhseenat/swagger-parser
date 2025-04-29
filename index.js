const express = require('express');
const axios = require('axios');
const vm = require('vm');
const cors = require("cors")
const app = express();
const PORT = 3000;
app.use(cors())
const fetchSwaggerDocFromJS = async (url) => {
  try {
    const res = await axios.get(url);

    // Extract `options = { ... };` block
    const match = res.data.match(/var options\s*=\s*({[\s\S]*?});/);
    if (!match) {
      console.error('Could not extract options object from script');
      throw new Error("Could not extract options object from script");
    }

    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(`options = ${match[1]}`, sandbox);

    return sandbox.options.swaggerDoc;
  } catch (error) {
    console.error("Error fetching Swagger doc:", error.message || error);
    throw new Error('Failed to fetch Swagger doc');
  }
};

const extractApiDetails = (swaggerDoc) => {
  const basePath = swaggerDoc.basePath || '';
  const paths = swaggerDoc.paths;
  const definitions = swaggerDoc.definitions || {};

  const buildExampleFromSchema = (schema, definitions) => {
    if (!schema) return {}; // Return empty object if schema is undefined

    if (schema.$ref) {
      const refKey = schema.$ref.replace('#/definitions/', '');
      schema = definitions[refKey];
    }

    const obj = {};
    if (schema && schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (propSchema.$ref) {
          obj[key] = buildExampleFromSchema(propSchema, definitions);
        } else {
          obj[key] = propSchema.default !== undefined
            ? propSchema.default
            : propSchema.type === 'number'
            ? 0
            : propSchema.type === 'string'
            ? ''
            : null;
        }
      }
    }
    return obj;
  };

  const apiDetails = [];

  for (const [route, methods] of Object.entries(paths)) {
    // Merge path-level parameters with method-level parameters
    const pathLevelParams = paths[route].parameters || [];

    for (const [method, config] of Object.entries(methods)) {
      const fullPath = `${basePath}${route}`;
      const entry = {
        method: method.toUpperCase(),
        path: fullPath,
      };

      // Merge path-level and method-level parameters
      const methodParams = config.parameters || [];
      const params = [...pathLevelParams, ...methodParams];
      
      // Add params if they exist
      if (params.length > 0) {
        entry.params = params.reduce((acc, param) => {
          if (param.in === 'body') {
            const bodyParam = {
              [param.name]: buildExampleFromSchema(param.schema, definitions),
            };
            acc.body = bodyParam;
          } else if (param.in === 'query' || param.in === 'path') {
            acc[param.in] = acc[param.in] || {};
            acc[param.in][param.name] = param.required ? null : undefined;  // Placeholder if required
          }
          return acc;
        }, {});
      }

      // If a body parameter exists, handle it as 'body' or other field names
      const bodyParam = (config.parameters || []).find(p => p.in === 'body');
      if (bodyParam?.schema?.properties) {
        const propEntries = Object.entries(bodyParam.schema.properties);
        if (propEntries.length > 0) {
          const [topKey, topSchema] = propEntries[0];
          const builtBody = topSchema.$ref
            ? buildExampleFromSchema({ $ref: topSchema.$ref }, definitions)
            : buildExampleFromSchema(topSchema, definitions);

          entry[topKey] = builtBody; // dynamic key like "check", "data", etc.
        } else {
          entry.body = {}; // fallback for empty object
        }
      } else if (method.toUpperCase() === 'GET') {
        entry.body = null;
      } else {
        entry.body = null;
      }

      apiDetails.push(entry);
    }
  }

  return apiDetails;
};

// Route to extract API details
app.get('/extracted', async (req, res) => {
  try {
    const url = req.query.swaggerUrl;
    const swaggerDoc = await fetchSwaggerDocFromJS(url);
    const extracted = extractApiDetails(swaggerDoc);
    res.json(extracted);
  } catch (error) {
    console.error("Error in /extracted route:", error.message || error);
    res.status(500).json({ error: 'Failed to fetch or parse Swagger doc' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
