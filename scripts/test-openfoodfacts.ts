const main = async () => {
    const FILE_PATH = "data/openfoodfacts-products.jsonl";
    const fs = require("fs");
    const readline = require("readline");
    const rl = readline.createInterface({
        input: fs.createReadStream(FILE_PATH),
        crlfDelay: Infinity,
    });

    let index = 0;

    const products = [];

    for await (const line of rl) {
        const product = JSON.parse(line);
        console.log(product);
        products.push(product);
        index++;
        if (index >= 10) break;
    }

    fs.writeFileSync("data/openfoodfacts-products-sample.json", JSON.stringify(products, null, 2));
}

main();