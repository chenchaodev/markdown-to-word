// @ts-check
/**
 * 关系部件解析测试(src/core/ooxml/part-rels.ts):
 * - r:id → 目标(内部相对路径 / 外部 URL)的映射
 * - 相对目标按「基准部件所在目录」解析成 OOXML 部件路径(含 ../ 与绝对式)
 * - 缺关系表 / 缺 rId ⇒ null
 * 纯函数段,无产物输出。
 */
import {
  findRelationship,
  parseRelationships,
  relationshipIds,
  resolvePartPath,
} from "../../../dist/core/ooxml/part-rels.js";
import { assert, createCaseSuite } from "../../harness/case.js";

export const meta = {
  description: "关系部件解析测试:rId→目标映射 + 相对目标解析成部件路径 + 缺失降级",
};
export const fixtures = null;

const RELS_XML = `<?xml version="1.0"?>
<Relationships xmlns="urn:rel">
  <Relationship Id="rId1" Type="urn:officeDocument/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="urn:officeDocument/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rId3" Type="urn:officeDocument/relationships/hyperlink" Target="https://example.com/a?x=1&amp;y=2" TargetMode="External"/>
</Relationships>`;

export async function run() {
  const suite = createCaseSuite();
  const rels = parseRelationships(RELS_XML);

  await suite.case("parseRelationships:读出内部与外部关系", () => {
    assert(rels.size === 3, `关系数应为 3,实际 ${rels.size}`);
    const image = findRelationship(rels, "rId2");
    assert(image?.target === "media/image1.png", `rId2 的目标应为 media/image1.png,实际 ${image?.target}`);
    assert(image?.external === false, "rId2 不是外部关系");
    assert(image?.type.includes("image"), "rId2 的类型应含 image");
  });

  await suite.case("外部关系:TargetMode=External 且目标原样保留(含实体解码)", () => {
    const link = findRelationship(rels, "rId3");
    assert(link?.external === true, "rId3 应是外部关系");
    assert(link?.target === "https://example.com/a?x=1&y=2", `目标应解码为 & 形态,实际 ${link?.target}`);
    assert(link?.targetMode === "External", "TargetMode 应为 External");
  });

  await suite.case("findRelationship:未知 rId 与空关系表 ⇒ null", () => {
    assert(findRelationship(rels, "rId999") === null, "未知 rId 应返回 null");
    assert(findRelationship(undefined, "rId1") === null, "缺关系表应返回 null");
    assert(relationshipIds(undefined).length === 0, "缺关系表时 id 列表为空");
    assert(relationshipIds(rels).length === 3, "关系 id 列表应有 3 条");
  });

  await suite.case("resolvePartPath:相对目标按基准部件目录解析", () => {
    assert(resolvePartPath("word/document.xml", "media/image1.png") === "word/media/image1.png", "同目录相对路径应解析");
    assert(resolvePartPath("word/document.xml", "styles.xml") === "word/styles.xml", "同目录文件应解析");
    assert(resolvePartPath("word/document.xml", "../customXml/item1.xml") === "customXml/item1.xml", "上一级应解析");
    assert(resolvePartPath("word/document.xml", "/word/media/x.png") === "word/media/x.png", "绝对式应去掉前导斜杠");
    assert(resolvePartPath("document.xml", "media/x.png") === "media/x.png", "无目录基准时按原样拼接");
    assert(resolvePartPath("word/document.xml", "./media/./x.png") === "word/media/x.png", "当前目录标记应被消掉");
  });

  await suite.case("parseRelationships:缺部件 / 畸形 ⇒ 空表(不抛)", () => {
    const empty = parseRelationships("");
    assert(empty.size === 0, "空部件应得到空关系表");
    const missing = parseRelationships(null);
    assert(missing.size === 0, "缺部件(null)应得到空关系表");
    const broken = parseRelationships("<Relationships><Relationship");
    assert(broken.size === 0, "畸形部件应得到空关系表");
  });

  console.log("[ok] 关系部件解析:rId 映射 + 路径解析 + 缺失降级 断言通过");
  return { cases: suite.results };
}
