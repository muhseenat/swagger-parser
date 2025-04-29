const express = require('express');
const axios = require('axios');
const vm = require('vm');

const app = express();
const PORT = 3000;

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
              : propSchema.type === 'boolean'
              ? false
              : propSchema.type === 'array'
              ? []
              : propSchema.type === 'object'
              ? {}
              : '';
          }
        }
      }
      return obj;
    };
  
    const apiDetails = [];
  
    for (const [route, methods] of Object.entries(paths)) {
      for (const [method, config] of Object.entries(methods)) {
        const fullPath = `${basePath}${route}`;
        const entry = {
          method: method.toUpperCase(),
          path: fullPath,
        };
  
        const params = config.parameters || [];
  
        // Body
        const bodyParam = params.find(p => p.in === 'body');
        if (bodyParam?.schema) {
          entry.body = buildExampleFromSchema(bodyParam.schema, definitions);
        } else {
          entry.body = null;
        }
  
        // Query params
        const queryParams = params.filter(p => p.in === 'query');
        if (queryParams.length > 0) {
          entry.query = {};
          queryParams.forEach(q => {
            entry.query[q.name] = q.default !== undefined
              ? q.default
              : q.type === 'number'
              ? 0
              : q.type === 'boolean'
              ? false
              : '';
          });
        }
  
        // Path params
        const pathParams = params.filter(p => p.in === 'path');
        if (pathParams.length > 0) {
          entry.params = {};
          pathParams.forEach(p => {
            entry.params[p.name] = p.default !== undefined
              ? p.default
              : p.type === 'number'
              ? 0
              : '';
          });
        }
  
        apiDetails.push(entry);
      }
    }
  
    return apiDetails;
  };
  

// Route to extract API details
app.get('/extracted', async (req, res) => {
  try {
    const url = req.query.swaggerUrl
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
