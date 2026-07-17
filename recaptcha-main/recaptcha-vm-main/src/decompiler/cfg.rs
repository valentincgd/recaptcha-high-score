use crate::disassembler::instructions::{Instruction, InstructionBase};
use petgraph::Direction;
use petgraph::graph::{DiGraph, NodeIndex};
use std::collections::{HashMap, HashSet};

fn is_unconditional_jump(instr: &InstructionBase<Instruction>) -> bool {
    matches!(instr.inner, Instruction::Jump(_))
}

fn is_conditional_jump(instr: &InstructionBase<Instruction>) -> bool {
    matches!(
        instr.inner,
        Instruction::JumpIfEq(_) | Instruction::JumpIfLt(_)
    )
}

fn jump_targets(instr: &InstructionBase<Instruction>) -> Vec<usize> {
    match &instr.inner {
        Instruction::Jump(j) => vec![j.target as usize],
        Instruction::JumpIfEq(j) => vec![j.target as usize],
        Instruction::JumpIfLt(j) => vec![j.target as usize],
        _ => vec![],
    }
}
#[derive(Debug, Clone)]
pub struct BasicBlock {
    pub start_offset: usize,
    pub end_offset: usize,
    pub instr_indices: Vec<usize>,
}

impl BasicBlock {
    pub fn label(&self) -> String {
        format!("BB_0x{:06x}", self.start_offset)
    }
}

#[derive(Debug, Clone)]
pub struct LoopInfo {
    pub header: NodeIndex,
    pub latch: NodeIndex,
    pub body: Vec<NodeIndex>,
}

pub struct ControlFlowGraph {
    pub graph: DiGraph<BasicBlock, ()>,
    pub offset_to_node: HashMap<usize, NodeIndex>,
    pub loops: Vec<LoopInfo>,
    pub entry: NodeIndex,
}

impl ControlFlowGraph {
    pub fn build(instructions: &[InstructionBase<Instruction>]) -> Self {
        let mut leaders: HashSet<usize> = HashSet::new();
        leaders.insert(instructions[0].offset);

        for (i, instr) in instructions.iter().enumerate() {
            let targets = jump_targets(instr);
            for t in targets {
                leaders.insert(t);
            }
            if (is_unconditional_jump(instr) || is_conditional_jump(instr))
                && i + 1 < instructions.len()
            {
                leaders.insert(instructions[i + 1].offset);
            }
        }

        let addr_to_instr_idx: HashMap<usize, usize> = instructions
            .iter()
            .enumerate()
            .map(|(i, instr)| (instr.offset, i))
            .collect();

        let mut sorted_leaders: Vec<usize> = leaders.iter().cloned().collect();
        sorted_leaders.sort_unstable();

        let mut blocks: Vec<BasicBlock> = Vec::new();

        for (li, &leader_addr) in sorted_leaders.iter().enumerate() {
            let start_instr_idx = match addr_to_instr_idx.get(&leader_addr) {
                Some(&i) => i,
                None => {
                    continue;
                }
            };

            let end_instr_idx = if li + 1 < sorted_leaders.len() {
                let next_leader = sorted_leaders[li + 1];
                match addr_to_instr_idx.get(&next_leader) {
                    Some(&i) => i,
                    None => instructions.len(),
                }
            } else {
                instructions.len()
            };

            if start_instr_idx >= end_instr_idx {
                continue;
            }

            let instr_indices: Vec<usize> = (start_instr_idx..end_instr_idx).collect();
            let end_offset = instructions[end_instr_idx - 1].offset;

            blocks.push(BasicBlock {
                start_offset: leader_addr,
                end_offset,
                instr_indices,
            });
        }

        let mut graph: DiGraph<BasicBlock, ()> = DiGraph::new();
        let mut offset_to_node: HashMap<usize, NodeIndex> = HashMap::new();

        for block in blocks {
            let addr = block.start_offset;
            let node = graph.add_node(block);
            offset_to_node.insert(addr, node);
        }

        let entry = *offset_to_node
            .get(&instructions[0].offset)
            .expect("entry block must exist");

        let mut edges: Vec<(NodeIndex, NodeIndex)> = Vec::new();

        for node in graph.node_indices() {
            let block = &graph[node];
            let last_idx = match block.instr_indices.last() {
                Some(&i) => i,
                None => continue,
            };
            let last_instr = &instructions[last_idx];

            if is_unconditional_jump(last_instr) {
                for target_addr in jump_targets(last_instr) {
                    if let Some(&target_node) = offset_to_node.get(&target_addr) {
                        edges.push((node, target_node));
                    }
                }
            } else if is_conditional_jump(last_instr) {
                for target_addr in jump_targets(last_instr) {
                    if let Some(&target_node) = offset_to_node.get(&target_addr) {
                        edges.push((node, target_node));
                    }
                }
                if last_idx + 1 < instructions.len() {
                    let next_addr = instructions[last_idx + 1].offset;
                    if let Some(&fall_node) = offset_to_node.get(&next_addr) {
                        edges.push((node, fall_node));
                    }
                }
            } else if last_idx + 1 < instructions.len() {
                let next_addr = instructions[last_idx + 1].offset;
                if let Some(&fall_node) = offset_to_node.get(&next_addr) {
                    edges.push((node, fall_node));
                }
            }
        }

        for (src, dst) in edges {
            if !graph.contains_edge(src, dst) {
                graph.add_edge(src, dst, ());
            }
        }
        let loops = Self::detect_loops(&graph, entry);

        Self {
            graph,
            offset_to_node,
            loops,
            entry,
        }
    }

    fn detect_loops(graph: &DiGraph<BasicBlock, ()>, _entry: NodeIndex) -> Vec<LoopInfo> {
        // we use scc since recap vm has multiple funcs with one entry point
        // so dominators doesnt work cus it requires a single entry point, it wouldnt detect it
        use petgraph::algo::tarjan_scc;

        let sccs = tarjan_scc(graph);
        let mut loops: Vec<LoopInfo> = Vec::new();

        let mut node_scc: HashMap<NodeIndex, usize> = HashMap::new();
        for (i, scc) in sccs.iter().enumerate() {
            for &n in scc {
                node_scc.insert(n, i);
            }
        }

        for (scc_idx, scc) in sccs.iter().enumerate() {
            let is_loop = scc.len() > 1 || graph.contains_edge(scc[0], scc[0]);

            if !is_loop {
                continue;
            }
            let header = scc
                .iter()
                .filter(|&&n| {
                    graph
                        .neighbors_directed(n, Direction::Incoming)
                        .any(|pred| node_scc.get(&pred) != Some(&scc_idx))
                })
                .min_by_key(|&&n| graph[n].start_offset)
                .copied()
                .unwrap_or(scc[0]);

            let latch = scc
                .iter()
                .find(|&&n| graph.contains_edge(n, header))
                .copied()
                .unwrap_or(header);

            let body: Vec<NodeIndex> = scc.iter().cloned().collect();

            loops.push(LoopInfo {
                header,
                latch,
                body,
            });
        }

        loops.sort_by_key(|l| l.body.len());

        loops
    }

    pub fn print_blocks(&self, instructions: &[InstructionBase<Instruction>]) {
        let mut nodes: Vec<NodeIndex> = self.graph.node_indices().collect();
        nodes.sort_by_key(|&n| self.graph[n].start_offset);

        let loop_headers: HashSet<NodeIndex> = self.loops.iter().map(|l| l.header).collect();
        let loop_latches: HashSet<NodeIndex> = self.loops.iter().map(|l| l.latch).collect();

        // map node, which loop indices it belongs to
        let mut node_loop_idx: HashMap<NodeIndex, Vec<usize>> = HashMap::new();
        for (i, lp) in self.loops.iter().enumerate() {
            for &n in &lp.body {
                node_loop_idx.entry(n).or_default().push(i);
            }
        }

        for node in nodes {
            let block = &self.graph[node];

            let mut annotations: Vec<&str> = Vec::new();
            if loop_headers.contains(&node) {
                annotations.push("LOOP_HEADER");
            }
            if loop_latches.contains(&node) {
                annotations.push("LOOP_LATCH");
            }

            let loop_ids = node_loop_idx.get(&node).cloned().unwrap_or_default();
            let loop_tag = if loop_ids.is_empty() {
                String::new()
            } else {
                let ids: Vec<String> = loop_ids.iter().map(|i| format!("L{}", i)).collect();
                format!("  [{}]", ids.join(", "))
            };

            print!(
                "\n {} (0x{:06x}–0x{:06x}){}",
                block.label(),
                block.start_offset,
                block.end_offset,
                loop_tag,
            );
            if !annotations.is_empty() {
                print!("  {}", annotations.join(", "));
            }
            println!();

            for &idx in &block.instr_indices {
                println!("   {}", instructions[idx]);
            }
            let succs: Vec<String> = self
                .graph
                .neighbors_directed(node, Direction::Outgoing)
                .map(|s| format!("0x{:06x}", self.graph[s].start_offset))
                .collect();
            if !succs.is_empty() {
                println!("  {}", succs.join("  │  "));
            } else {
                println!("no successors");
            }
        }

        println!();
        self.print_loops();
    }

    pub fn print_loops(&self) {
        if self.loops.is_empty() {
            println!("no loops detected");
            return;
        }

        for (i, lp) in self.loops.iter().enumerate() {
            let header_addr = self.graph[lp.header].start_offset;
            let latch_addr = self.graph[lp.latch].start_offset;

            let mut body_addrs: Vec<usize> = lp
                .body
                .iter()
                .map(|&n| self.graph[n].start_offset)
                .collect();
            body_addrs.sort_unstable();

            println!(
                "  L{i}: header=0x{:06x}  latch=0x{:06x}  body_blocks={}",
                header_addr,
                latch_addr,
                body_addrs
                    .iter()
                    .map(|a| format!("0x{:06x}", a))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    }

    pub fn block_containing(&self, addr: usize) -> Option<NodeIndex> {
        for node in self.graph.node_indices() {
            let block = &self.graph[node];
            if addr >= block.start_offset && addr <= block.end_offset {
                return Some(node);
            }
        }
        None
    }

    pub fn is_in_loop(&self, node: NodeIndex) -> bool {
        self.loops.iter().any(|l| l.body.contains(&node))
    }
}
